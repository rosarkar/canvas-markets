import "@/load-env.js";

import { createCanvasTables } from "@/adapters/schema.js";
import { connectDb } from "@/db.js";
import {
  expireStaleRulesPending,
  expireStaleVerifications,
} from "@/adapters/verification.adapter.js";
import { getGroupById } from "@/adapters/groups.adapter.js";
import { startDepositMonitor } from "@/services/deposit-monitor.js";
import { startPayoutBatchScheduler } from "@/services/payout-batch.js";
import { getBot, startTelegramBot } from "@/telegram/bot.js";
import { completeVerificationTimeout } from "@/telegram/services/verification-complete.js";
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
      })
      .catch((err) => logger.error({ err }, "TTL sweep failed"));

    // Missed the post-verification rules gate — leave the user muted, just log it.
    expireStaleRulesPending()
      .then((timedOut) => {
        for (const row of timedOut) {
          logger.warn(
            { verificationId: row.verificationId, tgUserId: row.tgUserId.toString(), groupId: row.groupId },
            "User did not agree to rules within 10 minutes — left muted",
          );
        }
      })
      .catch((err) => logger.error({ err }, "Rules-pending TTL sweep failed"));
  }, 60_000);

  logger.info("Canvas AI started");
  console.log("[canvas-ai] started — webhook mode, Rose-style captcha enabled");
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
