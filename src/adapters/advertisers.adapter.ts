import { db } from "@/db.js";
import { fromMicroUnits } from "@/utils/usdc.js";

export interface AdvertiserRow {
  tgId: bigint;
  walletAddress: string;
  createdAt: Date;
}

export async function linkAdvertiserWallet(tgId: bigint, walletAddress: string): Promise<void> {
  await db.query(
    `INSERT INTO advertisers (tg_id, wallet_address)
     VALUES ($1, $2)
     ON CONFLICT (tg_id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address`,
    [tgId.toString(), walletAddress.toLowerCase()],
  );
}

export async function getAdvertiserByTgId(tgId: bigint): Promise<AdvertiserRow | null> {
  const res = await db.query(
    `SELECT tg_id, wallet_address, created_at FROM advertisers WHERE tg_id = $1`,
    [tgId.toString()],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { tgId: BigInt(row.tg_id), walletAddress: row.wallet_address, createdAt: row.created_at };
}

export async function getAdvertiserByWallet(walletAddress: string): Promise<AdvertiserRow | null> {
  const res = await db.query(
    `SELECT tg_id, wallet_address, created_at FROM advertisers WHERE wallet_address = $1`,
    [walletAddress.toLowerCase()],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { tgId: BigInt(row.tg_id), walletAddress: row.wallet_address, createdAt: row.created_at };
}

export interface CampaignSummary {
  advertiserId: number;
  groupId: number;
  tgGroupId: string;
  groupTitle: string | null;
  bidPerVerification: number;
  remainingBudget: number;
  taskText: string | null;
  status: string;
  verificationsCompleted: number;
  createdAt: string;
}

export async function getCampaignsForWallet(walletAddress: string): Promise<CampaignSummary[]> {
  const advertiser = await getAdvertiserByWallet(walletAddress);
  if (!advertiser) return [];

  const res = await db.query(
    `SELECT
       ab.advertiser_id,
       ab.group_id,
       g.tg_group_id::TEXT AS tg_group_id,
       g.group_title,
       ab.bid_per_verification,
       ab.remaining_budget,
       ab.task_text,
       ab.campaign_status,
       ab.created_at,
       COALESCE(v_stats.passed, 0) AS verifications_completed
     FROM advertiser_budgets ab
     JOIN groups g ON ab.group_id = g.group_id
     LEFT JOIN (
       -- PASSED is now followed by a rules-agreement gate; count any post-pass state.
       SELECT advertiser_id, COUNT(*) FILTER (WHERE state IN ('PASSED', 'RULES_PENDING', 'ADMITTED', 'RULES_TIMED_OUT')) AS passed
       FROM verifications
       GROUP BY advertiser_id
     ) v_stats ON v_stats.advertiser_id = ab.advertiser_id
     WHERE ab.advertiser_tg_id = $1
     ORDER BY ab.created_at DESC`,
    [advertiser.tgId.toString()],
  );

  return res.rows.map((row) => ({
    advertiserId: row.advertiser_id as number,
    groupId: row.group_id as number,
    tgGroupId: row.tg_group_id as string,
    groupTitle: (row.group_title as string | null) ?? null,
    bidPerVerification: fromMicroUnits(BigInt(row.bid_per_verification as string)),
    remainingBudget: fromMicroUnits(BigInt(row.remaining_budget as string)),
    taskText: row.task_text as string | null,
    status: row.campaign_status as string,
    verificationsCompleted: Number(row.verifications_completed),
    createdAt: (row.created_at as Date).toISOString(),
  }));
}
