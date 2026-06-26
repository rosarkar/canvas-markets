import { db } from "@/db.js";

import { getPendingCampaignById } from "@/adapters/bidding.js";
import { creditDirectDeposit, getEscrowAddress } from "@/services/escrow.js";
import { verifyDepositSign } from "@/utils/deposit-sign.js";
import { logger } from "@/utils/logger.js";

export interface ConfirmDepositInput {
  paymentId: string;
  campaignId: number;
  amountMicro: bigint;
  expiryMs: number;
  sig: string;
}

export interface ConfirmDepositResult {
  ok: boolean;
  error?: string;
  creditTxHash?: string;
}

function usdStringToMicro(amount: string): bigint {
  const normalized = amount.replace(/,/g, "").trim();
  const parts = normalized.split(".");
  const whole = BigInt(parts[0] || "0");
  const frac = (parts[1] ?? "").padEnd(6, "0").slice(0, 6);
  return whole * 1_000_000n + BigInt(frac || "0");
}

async function fetchPaymentStatus(paymentId: string): Promise<{
  status: string;
  sender?: string;
  recipient?: string;
  amount?: string;
}> {
  const { getPaymentStatus } = await import("@base-org/account");
  return getPaymentStatus({ id: paymentId, testnet: false }) as Promise<{
    status: string;
    sender?: string;
    recipient?: string;
    amount?: string;
  }>;
}

export async function confirmCampaignDepositPay(
  input: ConfirmDepositInput,
): Promise<ConfirmDepositResult> {
  const escrow = getEscrowAddress();
  if (!escrow) return { ok: false, error: "Escrow not configured" };

  if (!verifyDepositSign(input.campaignId, input.amountMicro, input.expiryMs, input.sig)) {
    return { ok: false, error: "Invalid or expired deposit link" };
  }

  const campaign = await getPendingCampaignById(input.campaignId);
  if (!campaign || campaign.campaignStatus !== "pending_deposit") {
    return { ok: false, error: "Campaign not awaiting deposit" };
  }

  if (input.amountMicro !== campaign.expectedDepositMicro) {
    return { ok: false, error: "Amount mismatch" };
  }

  const existing = await db.query<{ status: string; credit_tx_hash: string | null }>(
    `SELECT status, credit_tx_hash FROM payment_credits WHERE payment_id = $1`,
    [input.paymentId],
  );
  const prior = existing.rows[0];
  if (prior?.status === "confirmed") {
    return { ok: true, creditTxHash: prior.credit_tx_hash ?? undefined };
  }
  if (prior?.status === "submitted" && prior.credit_tx_hash) {
    return { ok: true, creditTxHash: prior.credit_tx_hash };
  }

  let paymentStatus: Awaited<ReturnType<typeof fetchPaymentStatus>>;
  try {
    paymentStatus = await fetchPaymentStatus(input.paymentId);
  } catch (err) {
    logger.error({ err, paymentId: input.paymentId }, "getPaymentStatus failed");
    return { ok: false, error: "Could not verify payment" };
  }

  if (paymentStatus.status !== "completed") {
    return { ok: false, error: `Payment not completed (${paymentStatus.status})` };
  }

  const paidMicro = paymentStatus.amount ? usdStringToMicro(paymentStatus.amount) : 0n;
  if (paidMicro < campaign.expectedDepositMicro) {
    return { ok: false, error: "Payment amount too low" };
  }

  if (
    paymentStatus.recipient &&
    paymentStatus.recipient.toLowerCase() !== escrow.toLowerCase()
  ) {
    return { ok: false, error: "Payment recipient mismatch" };
  }

  const sender = paymentStatus.sender ?? "0x0000000000000000000000000000000000000000";

  if (!prior) {
    await db.query(
      `INSERT INTO payment_credits (payment_id, campaign_id, amount_micro, sender, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [input.paymentId, input.campaignId, input.amountMicro.toString(), sender],
    );
  }

  const txHash = await creditDirectDeposit(input.campaignId, sender, campaign.expectedDepositMicro);
  if (!txHash) {
    await db.query(
      `UPDATE payment_credits SET status = 'failed' WHERE payment_id = $1`,
      [input.paymentId],
    );
    return { ok: false, error: "On-chain credit failed" };
  }

  await db.query(
    `UPDATE payment_credits SET status = 'confirmed', credit_tx_hash = $2 WHERE payment_id = $1`,
    [input.paymentId, txHash],
  );

  return { ok: true, creditTxHash: txHash };
}
