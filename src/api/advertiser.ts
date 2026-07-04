import { Router, type Request, type Response } from "express";

import { getCampaignsForWallet, getAdvertiserByWallet } from "@/adapters/advertisers.adapter.js";
import { requireWalletAuth } from "@/api/wallet-auth.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/i;

export const advertiserRouter = Router();

advertiserRouter.get("/api/advertiser", requireWalletAuth, async (req: Request, res: Response) => {
  const wallet = req.query.wallet as string | undefined;

  if (!wallet || !WALLET_RE.test(wallet)) {
    res.status(400).json({ error: "Invalid or missing wallet address" });
    return;
  }

  const advertiser = await getAdvertiserByWallet(wallet);
  if (!advertiser) {
    res.status(404).json({ error: "No account found for this wallet. Run /link in the Canvas bot first." });
    return;
  }

  const campaigns = await getCampaignsForWallet(wallet);

  const totalSpend = campaigns.reduce((sum, c) => {
    const spent = c.verificationsCompleted * c.bidPerVerification;
    return sum + spent;
  }, 0);

  const totalVerifications = campaigns.reduce((sum, c) => sum + c.verificationsCompleted, 0);

  res.json({
    wallet: advertiser.walletAddress,
    campaigns,
    totals: {
      campaigns: campaigns.length,
      verificationsCompleted: totalVerifications,
      totalSpend: Math.round(totalSpend * 100) / 100,
    },
  });
});
