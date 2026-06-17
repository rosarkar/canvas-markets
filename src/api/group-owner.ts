import { Router, type Request, type Response } from "express";

import { getGroupOwnerStats } from "@/adapters/groups.adapter.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/i;

export const groupOwnerRouter = Router();

groupOwnerRouter.get("/api/group-owner", async (req: Request, res: Response) => {
  const wallet = req.query.wallet as string | undefined;

  if (!wallet || !WALLET_RE.test(wallet)) {
    res.status(400).json({ error: "Invalid or missing wallet address" });
    return;
  }

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
