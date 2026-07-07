import type { Api } from "grammy";

import { db } from "@/db.js";
import { getGroupById } from "@/adapters/groups.adapter.js";
import { getVerificationByToken, transitionState } from "@/adapters/verification.adapter.js";
import { sendAdminAlert } from "@/services/admin-alerts.js";
import { scoreWithKimi } from "@/services/scoring.js";
import { VerificationState } from "@/services/verification-states.js";
import {
  buildScoringPrompt,
  completeScoredVerification,
} from "@/telegram/services/process-text-response.js";
import { completeVerificationScoringUnavailable } from "@/telegram/services/verification-complete.js";
import { logger } from "@/utils/logger.js";

/** Sweep retries at ~2-minute spacing; exhausted after ~10 minutes of Kimi outage. */
const MAX_SCORING_RETRIES = 4;

/**
 * Scoring retry queue (BUILD.md "Kimi outage fails closed" Phase 2 fix).
 *
 * When Kimi errors mid-verification, finalize() parks the row in SCORING instead of
 * failing the user. This sweep re-runs scoring for parked rows every minute: success
 * completes the verification through the same CAS transitions as the immediate path;
 * persistent failure across MAX_SCORING_RETRIES fails closed for real and alerts the
 * admin. Genuine low scores are never retried — only transport/parse errors defer.
 */
export async function retryDeferredScoring(api: Api): Promise<void> {
  const res = await db.query<{ verification_id: string; scoring_retries: number }>(
    `SELECT verification_id, scoring_retries FROM verifications
     WHERE state = 'SCORING'
       AND response_text IS NOT NULL
       AND advertiser_id IS NOT NULL
       AND updated_at < NOW() - INTERVAL '2 minutes'
     ORDER BY updated_at ASC
     LIMIT 10`,
  );

  for (const row of res.rows) {
    const verification = await getVerificationByToken(row.verification_id);
    if (!verification || verification.state !== VerificationState.SCORING) continue;
    if (!verification.responseText) continue;

    const prompt = await buildScoringPrompt(verification);
    const result = await scoreWithKimi(prompt, verification.responseText, { failClosed: true });

    if (result.method !== "fail_closed") {
      await completeScoredVerification(api, verification, result);
      logger.info(
        { verificationId: row.verification_id, score: result.score, retries: row.scoring_retries },
        "Deferred scoring completed on retry",
      );
      continue;
    }

    if (row.scoring_retries + 1 >= MAX_SCORING_RETRIES) {
      // Kimi unreachable across the whole retry window. This is our outage, not the
      // user's answer: exit via SCORING_UNAVAILABLE (no cooldown, exempt from the 12h
      // window) so they can retry as soon as scoring recovers.
      const marked = await transitionState(row.verification_id, VerificationState.SCORING_UNAVAILABLE, {
        expectedState: VerificationState.SCORING,
      });
      if (!marked) continue;
      const group = await getGroupById(verification.groupId);
      if (group) {
        await completeVerificationScoringUnavailable(api, verification.entryType, group, verification.tgUserId);
      }
      await sendAdminAlert(
        `Scoring retry queue exhausted — verification ${row.verification_id.slice(0, 8)}… closed as ` +
          `SCORING_UNAVAILABLE after ${MAX_SCORING_RETRIES} Kimi retries. User was NOT penalized ` +
          `(no cooldown — free to retry). Check Kimi/API status.`,
        api,
      );
      continue;
    }

    await db.query(
      `UPDATE verifications
       SET scoring_retries = scoring_retries + 1,
           expires_at = NOW() + INTERVAL '15 minutes',
           updated_at = NOW()
       WHERE verification_id = $1 AND state = 'SCORING'`,
      [row.verification_id],
    );
    logger.warn(
      { verificationId: row.verification_id, retries: row.scoring_retries + 1 },
      "Kimi still failing — scoring deferred again",
    );
  }
}
