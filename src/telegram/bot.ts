import { autoRetry } from "@grammyjs/auto-retry";
import express from "express";
import { Bot, webhookCallback } from "grammy";

import { config } from "@/config/index.js";
import { registerJoinHandler } from "@/telegram/handlers/join.js";
import { registerMessageHandler } from "@/telegram/handlers/message.js";
import { registerStartHandler } from "@/telegram/handlers/start.js";
import { logger } from "@/utils/logger.js";

let bot: Bot | null = null;

export function getBot(): Bot {
  if (!bot) throw new Error("Telegram bot not started");
  return bot;
}

export function startTelegramBot(): void {
  bot = new Bot(config.telegram.botToken);
  bot.api.config.use(autoRetry());

  registerStartHandler(bot);
  registerJoinHandler(bot);
  registerMessageHandler(bot);

  bot.catch((err) => {
    logger.error({ err: err.error, update: err.ctx.update }, "Telegram bot error");
  });

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "canvas-ai" });
  });

  app.post("/telegram/webhook", (req, res) => {
    const secret = config.telegram.webhookSecret;
    if (secret) {
      const header = req.headers["x-telegram-bot-api-secret-token"];
      if (header !== secret) {
        res.status(403).json({ error: "invalid webhook secret" });
        return;
      }
    }
    return webhookCallback(bot!, "express")(req, res);
  });

  app.listen(config.telegram.webhookPort, "0.0.0.0", () => {
    logger.info(`Canvas AI webhook listening on port ${config.telegram.webhookPort}`);
  });

  bot.api
    .setWebhook(config.telegram.webhookUrl, {
      secret_token: config.telegram.webhookSecret || undefined,
      allowed_updates: ["message", "chat_member", "my_chat_member", "callback_query"],
    })
    .then(() => logger.info(`Webhook registered → ${config.telegram.webhookUrl}`))
    .catch((err) => {
      logger.error({ err }, "Failed to set Telegram webhook");
      process.exit(1);
    });
}
