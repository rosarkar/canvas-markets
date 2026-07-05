import { Router, type Request, type Response } from "express";

import { getGroupOwnerStats } from "@/adapters/groups.adapter.js";
import { requireWalletAuth } from "@/api/wallet-auth.js";

export const groupOwnerRouter = Router();

groupOwnerRouter.get("/api/group-owner", requireWalletAuth, async (req: Request, res: Response) => {
  // Presence, format, and ownership proof all enforced by requireWalletAuth.
  const wallet = req.query.wallet as string;

  const groups = await getGroupOwnerStats(wallet);

  if (groups.length === 0) {
    res.status(404).json({
      error: "No groups found for this wallet. Register a group with /register, then set your payout wallet with /wallet 0xAddress.",
    });
    return;
  }

  const totalVerifications = groups.reduce((s, g) => s + g.totalVerifications, 0);
  const totalPendingEarnings = groups.reduce((s, g) => s + g.pendingEarnings, 0);

  res.json({
    wallet: wallet.toLowerCase(),
    groups,
    totals: {
      groups: groups.length,
      totalVerifications,
      totalPendingEarnings: Math.round(totalPendingEarnings * 100) / 100,
    },
  });
});
