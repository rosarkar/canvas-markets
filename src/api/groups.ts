import { Router, type Request, type Response } from "express";

import { db } from "@/db.js";
import { requireWalletAuth } from "@/api/wallet-auth.js";
import { getBot } from "@/telegram/bot.js";
import { fromMicroUnits } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

export const groupsRouter = Router();

/**
 * Registered-groups listing for the advertiser dashboard's Available Groups tab.
 * Signed-wallet gated like the other read endpoints — any advertiser with a valid
 * signature may browse (marketplace data, not per-wallet private data).
 *
 * `topic` is always null for now: nothing in registration collects one yet.
 * `member_count` is fetched live from Telegram per group; 0 when unavailable.
 */
groupsRouter.get("/api/groups", requireWalletAuth, async (_req: Request, res: Response) => {
  const rows = await db.query<{
    tg_group_id: string;
    group_title: string | null;
    top_bid: string;
  }>(
    `SELECT g.tg_group_id::TEXT AS tg_group_id,
            g.group_title,
            COALESCE(MAX(ab.bid_per_verification) FILTER (WHERE ab.campaign_status = 'active'), 0) AS top_bid
     FROM groups g
     LEFT JOIN advertiser_budgets ab ON ab.group_id = g.group_id
     WHERE g.is_active = true
     GROUP BY g.group_id
     ORDER BY g.group_id`,
  );

  const api = getBot().api;
  const groups = await Promise.all(
    rows.rows.map(async (row) => {
      let memberCount = 0;
      try {
        memberCount = await api.getChatMemberCount(Number(row.tg_group_id));
      } catch (err) {
        logger.warn({ err, tgGroupId: row.tg_group_id }, "getChatMemberCount failed for /api/groups");
      }
      return {
        tg_group_id: Number(row.tg_group_id),
        group_title: row.group_title ?? null,
        topic: null as string | null,
        member_count: memberCount,
        top_bid: fromMicroUnits(BigInt(row.top_bid)),
      };
    }),
  );

  res.json(groups);
});
