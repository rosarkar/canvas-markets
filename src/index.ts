import "@/load-env.js";

import { createCanvasTables } from "@/adapters/schema.js";
import { connectDb } from "@/db.js";
import { expireStaleVerifications } from "@/adapters/verification.adapter.js";
import { getBot, startTelegramBot } from "@/telegram/bot.js";
import { rejectUser } from "@/telegram/verification-actions.js";
import { logger } from "@/utils/logger.js";

async function main(): Promise<void> {
  // Bind /health before DB so Railway healthchecks don't fail on slow Postgres cold start.
  startTelegramBot();

  await connectDb();
  await createCanvasTables();

  // Expire stale verifications every minute
  setInterval(() => {
    expireStaleVerifications()
      .then(async (expired) => {
        if (expired.length === 0) return;
        logger.info({ expired: expired.length }, "Expired stale verifications");
        const api = getBot().api;
        for (const row of expired) {
          await rejectUser(api, row.tgGroupId, row.tgUserId);
        }
      })
      .catch((err) => logger.error({ err }, "TTL sweep failed"));
  }, 60_000);

  logger.info("Canvas AI started");
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
