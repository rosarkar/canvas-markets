import { Bot } from "grammy";

export function registerStartHandler(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Canvas AI — monetise your Telegram group gating.\n\n" +
        "Group owners: send /register\n" +
        "Advertisers: send /buy",
    );
  });

  bot.command("buy", async (ctx) => {
    await ctx.reply(
      "Advertiser buy flow — coming in next build step.\n\n" +
        "You'll select groups, set bid per verification, and fund escrow.",
    );
  });
}
