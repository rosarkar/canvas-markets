import "@/load-env.js";

import { createCanvasTables } from "@/adapters/schema.js";
import { connectDb } from "@/db.js";
import { expireStaleVerifications } from "@/adapters/verification.adapter.js";
import { startTelegramBot } from "@/telegram/bot.js";
import { logger } from "@/utils/logger.js";

async function main(): Promise<void> {
  await connectDb();
  await createCanvasTables();
  startTelegramBot();

  // Expire stale verifications every minute
  setInterval(() => {
    expireStaleVerifications()
      .then((n) => {
        if (n > 0) logger.info({ expired: n }, "Expired stale verifications");
      })
      .catch((err) => logger.error({ err }, "TTL sweep failed"));
  }, 60_000);

  logger.info("Canvas AI started");
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
