import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "@/config/index.js";

export function signDepositUrl(campaignId: number, amountMicro: bigint, expiryMs: number): string {
  const secret = config.payments.depositUrlSecret;
  if (!secret) throw new Error("DEPOSIT_URL_SECRET not configured");
  const payload = `${campaignId}:${amountMicro.toString()}:${expiryMs}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyDepositSign(
  campaignId: number,
  amountMicro: bigint,
  expiryMs: number,
  sig: string,
): boolean {
  const secret = config.payments.depositUrlSecret;
  if (!secret || !sig) return false;
  if (Date.now() > expiryMs) return false;
  const expected = signDepositUrl(campaignId, amountMicro, expiryMs);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildDepositPageUrl(campaignId: number, amountMicro: bigint): string {
  const ttlMs = config.payments.depositTtlMs;
  const exp = Date.now() + ttlMs;
  const sig = signDepositUrl(campaignId, amountMicro, exp);
  const base = config.payments.miniAppBaseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    campaign: String(campaignId),
    amount: amountMicro.toString(),
    exp: String(exp),
    sig,
  });
  return `${base}/mini-app/deposit.html?${params.toString()}`;
}
