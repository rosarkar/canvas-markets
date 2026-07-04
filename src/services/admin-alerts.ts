import type { Api } from "grammy";

import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";

/**
 * DM an operational alert to the admin (ADMIN_TELEGRAM_ID). Silent failures — failed
 * payouts, failed refunds, stuck-state sweeps — otherwise only surface in Railway logs.
 *
 * Never throws: alerting must not take down the money path that just failed. No-op
 * when ADMIN_TELEGRAM_ID is unset. Plain text (no parse_mode) so group titles with
 * markdown characters can't break the send.
 */
export async function sendAdminAlert(text: string, api?: Api): Promise<void> {
  const adminId = config.telegram.adminTelegramId;
  if (!adminId) return;

  try {
    // Lazy import so this module can be used from handlers registered by bot.ts
    // without creating a static import cycle (bot.ts → handler → here → bot.ts).
    const send = api ?? (await import("@/telegram/bot.js")).getBot().api;
    await send.sendMessage(Number(adminId), `🚨 ${text}`);
  } catch (err) {
    logger.warn({ err, alert: text }, "Failed to send admin alert DM");
  }
}

/** "abc12345…, def67890… +3 more" — keeps alert DMs short when many rows fail at once. */
export function previewIds(ids: string[], max = 3): string {
  const shown = ids.slice(0, max).map((id) => `${id.slice(0, 8)}…`);
  const rest = ids.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}
