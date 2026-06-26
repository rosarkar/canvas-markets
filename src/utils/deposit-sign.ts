import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "@/config/index.js";

export function verifyDepositSign(
  campaignId: number,
  amountMicro: bigint,
  expiryMs: number,
  sig: string,
): boolean {
  const amount = amountMicro.toString();
  return (
    verifySignedPayload(`campaign:${campaignId}:${amount}:${expiryMs}`, expiryMs, sig) ||
    verifySignedPayload(`${campaignId}:${amount}:${expiryMs}`, expiryMs, sig)
  );
}

export function signTopUpDepositUrl(topupId: number, amountMicro: bigint, expiryMs: number): string {
  const secret = config.payments.depositUrlSecret;
  if (!secret) throw new Error("DEPOSIT_URL_SECRET not configured");
  const payload = `topup:${topupId}:${amountMicro.toString()}:${expiryMs}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyTopUpDepositSign(
  topupId: number,
  amountMicro: bigint,
  expiryMs: number,
  sig: string,
): boolean {
  return verifySignedPayload(`topup:${topupId}:${amountMicro.toString()}:${expiryMs}`, expiryMs, sig);
}

function verifySignedPayload(payload: string, expiryMs: number, sig: string): boolean {
  const secret = config.payments.depositUrlSecret;
  if (!secret || !sig) return false;
  if (Date.now() > expiryMs) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function signDepositUrl(campaignId: number, amountMicro: bigint, expiryMs: number): string {
  const secret = config.payments.depositUrlSecret;
  if (!secret) throw new Error("DEPOSIT_URL_SECRET not configured");
  const payload = `campaign:${campaignId}:${amountMicro.toString()}:${expiryMs}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
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

export function buildTopUpDepositPageUrl(
  topupId: number,
  campaignId: number,
  amountMicro: bigint,
): string {
  const ttlMs = config.payments.depositTtlMs;
  const exp = Date.now() + ttlMs;
  const sig = signTopUpDepositUrl(topupId, amountMicro, exp);
  const base = config.payments.miniAppBaseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    campaign: String(campaignId),
    topup: String(topupId),
    amount: amountMicro.toString(),
    exp: String(exp),
    sig,
  });
  return `${base}/mini-app/deposit.html?${params.toString()}`;
}
