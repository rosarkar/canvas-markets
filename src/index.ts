import "@/load-env.js";

import { createCanvasTables } from "@/adapters/schema.js";
import { connectDb } from "@/db.js";
import {
  expireStaleRulesPending,
  expireStaleVerifications,
  getStuckPassedVerifications,
} from "@/adapters/verification.adapter.js";
import { getGroupById } from "@/adapters/groups.adapter.js";
import { previewIds, sendAdminAlert } from "@/services/admin-alerts.js";
import { startDepositMonitor } from "@/services/deposit-monitor.js";
import { startPayoutBatchScheduler } from "@/services/payout-batch.js";
import { retryDeferredScoring } from "@/services/scoring-retry.js";
import { getBot, startTelegramBot } from "@/telegram/bot.js";
import { runAutoAcceptSweep } from "@/telegram/handlers/campaign-approval.js";
import {
  completeVerificationPass,
  completeVerificationTimeout,
} from "@/telegram/services/verification-complete.js";
import { logger } from "@/utils/logger.js";

async function main(): Promise<void> {
  // Bind /health before DB so Railway healthchecks don't fail on slow Postgres cold start.
  startTelegramBot();

  await connectDb();
  await createCanvasTables();

  startDepositMonitor();
  startPayoutBatchScheduler();

  // Expire stale verifications every minute
  setInterval(() => {
    // Kimi-outage retry queue: re-score rows parked in SCORING before the TTL sweep
    // can touch them (deferral pushes their expires_at out 15 min).
    retryDeferredScoring(getBot().api).catch((err) =>
      logger.error({ err }, "Scoring retry sweep failed"),
    );

    expireStaleVerifications()
      .then(async (expired) => {
        if (expired.length === 0) return;
        logger.info({ expired: expired.length }, "Expired stale verifications");
        const api = getBot().api;
        for (const row of expired) {
          const group = await getGroupById(row.groupId);
          if (!group) continue;
          await completeVerificationTimeout(api, row.entryType, group, row.tgUserId);
        }
        // Rows swept out of RESPONSE_RECEIVED/SCORING were stranded mid-finalize by a
        // crash — the user sat muted with no retry path until this sweep caught them.
        const stranded = expired.filter(
          (row) => row.previousState === "RESPONSE_RECEIVED" || row.previousState === "SCORING",
        );
        if (stranded.length > 0) {
          await sendAdminAlert(
            `Stuck-state sweep: recovered ${stranded.length} verification(s) stranded mid-scoring ` +
              `(crashed finalize) — timed out and unblocked. ` +
              `Verification(s): ${previewIds(stranded.map((row) => row.verificationId))}`,
          );
        }
      })
      .catch((err) => logger.error({ err }, "TTL sweep failed"));

    // Rows stranded in PASSED (completeVerificationPass crashed before the RULES_PENDING
    // transition): re-run completeVerificationPass — it resends the rules DM, moves the
    // row to RULES_PENDING with a fresh TTL, and runs the payout accrual that never fired.
    // If the DM fails again the rules-pending sweep below terminalizes it to
    // RULES_TIMED_OUT, leaving the user muted (never unmuted without an "I agree" tap).
    getStuckPassedVerifications()
      .then(async (stuck) => {
        if (stuck.length === 0) return;
        const api = getBot().api;
        let recovered = 0;
        for (const row of stuck) {
          const group = await getGroupById(row.groupId);
          if (!group) continue;
          try {
            await completeVerificationPass(
              api,
              row.verificationId,
              group,
              group.groupTitle ?? "the group",
              "",
            );
            recovered += 1;
          } catch (err) {
            logger.error(
              { err, verificationId: row.verificationId },
              "Stuck-PASSED recovery attempt failed — will retry next sweep",
            );
          }
        }
        await sendAdminAlert(
          `Stuck-state sweep: ${recovered}/${stuck.length} verification(s) recovered from stranded PASSED ` +
            `(rules DM re-sent, payout accrual completed). ` +
            `Verification(s): ${previewIds(stuck.map((row) => row.verificationId))}`,
        );
      })
      .catch((err) => logger.error({ err }, "Stuck-PASSED recovery sweep failed"));

    // Missed the post-verification rules gate — leave the user muted, just log it.
    expireStaleRulesPending()
      .then(async (timedOut) => {
        for (const row of timedOut) {
          logger.warn(
            { verificationId: row.verificationId, tgUserId: row.tgUserId.toString(), groupId: row.groupId },
            "User did not agree to rules within 10 minutes — left muted",
          );
        }
        if (timedOut.length > 0) {
          await sendAdminAlert(
            `Stuck-state sweep: ${timedOut.length} user(s) missed the rules-agreement window and were left muted. ` +
              `Verification(s): ${previewIds(timedOut.map((row) => row.verificationId))}`,
          );
        }
      })
      .catch((err) => logger.error({ err }, "Rules-pending TTL sweep failed"));
  }, 60_000);

  // Auto-accept campaigns the group owner ignored for 48h (hourly is plenty).
  setInterval(() => {
    runAutoAcceptSweep(getBot().api).catch((err) =>
      logger.error({ err }, "Campaign auto-accept sweep failed"),
    );
  }, 3_600_000);

  logger.info("Canvas AI started");
  console.log("[canvas-ai] started — webhook mode, Rose-style captcha enabled");
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
