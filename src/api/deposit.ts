import { Router, type Request, type Response } from "express";

import { confirmCampaignDepositPay } from "@/services/deposit-confirm.js";
import { getEscrowAddress } from "@/services/escrow.js";

export const depositRouter = Router();

depositRouter.get("/api/deposit/config", (_req: Request, res: Response) => {
  const escrow = getEscrowAddress();
  if (!escrow) {
    res.status(503).json({ error: "Escrow not configured" });
    return;
  }
  res.json({ escrowAddress: escrow, chainId: 8453, chainName: "Base" });
});

  depositRouter.post("/api/deposit/confirm", async (req: Request, res: Response) => {
  const { paymentId, campaignId, amountMicro, exp, sig, topup } = req.body as {
    paymentId?: string;
    campaignId?: number | string;
    amountMicro?: string | number;
    exp?: string | number;
    sig?: string;
    topup?: number | string;
  };

  if (!paymentId || campaignId == null || amountMicro == null || exp == null || !sig) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  try {
    const result = await confirmCampaignDepositPay({
      paymentId,
      campaignId: Number(campaignId),
      amountMicro: BigInt(String(amountMicro)),
      expiryMs: Number(exp),
      sig,
      topupId: topup != null ? Number(topup) : undefined,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});
