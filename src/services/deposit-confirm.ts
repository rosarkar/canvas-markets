import { db } from "@/db.js";

import {
  confirmCampaignDeposit,
  confirmTopUpDeposit,
  getPendingCampaignById,
  getPendingTopUpById,
} from "@/adapters/bidding.js";
import { creditDirectDeposit, getEscrowAddress } from "@/services/escrow.js";
import { verifyDepositSign, verifyTopUpDepositSign } from "@/utils/deposit-sign.js";
import { logger } from "@/utils/logger.js";

export interface ConfirmDepositInput {
  paymentId: string;
  campaignId: number;
  amountMicro: bigint;
  expiryMs: number;
  sig: string;
  topupId?: number;
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

async function loadPriorPayment(paymentId: string) {
  const existing = await db.query<{ status: string; credit_tx_hash: string | null }>(
    `SELECT status, credit_tx_hash FROM payment_credits WHERE payment_id = $1`,
    [paymentId],
  );
  return existing.rows[0];
}

async function verifyBasePayPayment(
  paymentId: string,
  escrow: string,
  requiredMicro: bigint,
): Promise<{ ok: true; sender: string } | { ok: false; error: string }> {
  let paymentStatus: Awaited<ReturnType<typeof fetchPaymentStatus>>;
  try {
    paymentStatus = await fetchPaymentStatus(paymentId);
  } catch (err) {
    logger.error({ err, paymentId }, "getPaymentStatus failed");
    return { ok: false, error: "Could not verify payment" };
  }

  if (paymentStatus.status !== "completed") {
    return { ok: false, error: `Payment not completed (${paymentStatus.status})` };
  }

  const paidMicro = paymentStatus.amount ? usdStringToMicro(paymentStatus.amount) : 0n;
  if (paidMicro < requiredMicro) {
    return { ok: false, error: "Payment amount too low" };
  }

  if (
    paymentStatus.recipient &&
    paymentStatus.recipient.toLowerCase() !== escrow.toLowerCase()
  ) {
    return { ok: false, error: "Payment recipient mismatch" };
  }

  return {
    ok: true,
    sender: paymentStatus.sender ?? "0x0000000000000000000000000000000000000000",
  };
}

async function creditAndRecord(input: {
  paymentId: string;
  campaignId: number;
  amountMicro: bigint;
  sender: string;
  topupId?: number;
}): Promise<ConfirmDepositResult> {
  const prior = await loadPriorPayment(input.paymentId);
  if (prior?.status === "confirmed") {
    return { ok: true, creditTxHash: prior.credit_tx_hash ?? undefined };
  }

  if (!prior) {
    await db.query(
      `INSERT INTO payment_credits (payment_id, campaign_id, topup_id, amount_micro, sender, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [
        input.paymentId,
        input.campaignId,
        input.topupId ?? null,
        input.amountMicro.toString(),
        input.sender,
      ],
    );
  }

  const txHash = await creditDirectDeposit(
    input.campaignId,
    input.sender,
    input.amountMicro,
    { waitForFundsMs: 90_000 },
  );
  if (!txHash) {
    await db.query(`UPDATE payment_credits SET status = 'failed' WHERE payment_id = $1`, [
      input.paymentId,
    ]);
    return {
      ok: false,
      error:
        "Payment received but on-chain credit is still pending. Your USDC is in escrow — we'll retry automatically, or refresh this page in a minute.",
    };
  }

  await db.query(
    `UPDATE payment_credits SET status = 'confirmed', credit_tx_hash = $2 WHERE payment_id = $1`,
    [input.paymentId, txHash],
  );

  return { ok: true, creditTxHash: txHash };
}

export async function confirmCampaignDepositPay(
  input: ConfirmDepositInput,
): Promise<ConfirmDepositResult> {
  const escrow = getEscrowAddress();
  if (!escrow) return { ok: false, error: "Escrow not configured" };

  if (input.topupId != null) {
    if (!verifyTopUpDepositSign(input.topupId, input.amountMicro, input.expiryMs, input.sig)) {
      return { ok: false, error: "Invalid or expired deposit link" };
    }

    const topup = await getPendingTopUpById(input.topupId);
    if (!topup || topup.status !== "pending") {
      return { ok: false, error: "Top-up not awaiting deposit" };
    }
    if (topup.advertiserId !== input.campaignId) {
      return { ok: false, error: "Campaign mismatch" };
    }
    if (input.amountMicro !== topup.amountMicro) {
      return { ok: false, error: "Amount mismatch" };
    }

    const payment = await verifyBasePayPayment(input.paymentId, escrow, topup.amountMicro);
    if (!payment.ok) return { ok: false, error: payment.error };

    const credited = await creditAndRecord({
      paymentId: input.paymentId,
      campaignId: input.campaignId,
      amountMicro: topup.amountMicro,
      sender: payment.sender,
      topupId: input.topupId,
    });
    if (!credited.ok || !credited.creditTxHash) return credited;

    await confirmTopUpDeposit(input.topupId, credited.creditTxHash, topup.amountMicro);
    return credited;
  }

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

  const payment = await verifyBasePayPayment(input.paymentId, escrow, campaign.expectedDepositMicro);
  if (!payment.ok) return { ok: false, error: payment.error };

  const credited = await creditAndRecord({
    paymentId: input.paymentId,
    campaignId: input.campaignId,
    amountMicro: campaign.expectedDepositMicro,
    sender: payment.sender,
  });
  if (!credited.ok || !credited.creditTxHash) return credited;

  await confirmCampaignDeposit(input.campaignId, credited.creditTxHash, campaign.expectedDepositMicro);
  return credited;
}
