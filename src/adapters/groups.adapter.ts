import { db } from "@/db.js";
import { fromMicroUnits } from "@/utils/usdc.js";

export interface GroupRow {
  groupId: number;
  tgGroupId: bigint;
  groupTitle: string | null;
  ownerWallet: string;
  ownerTgId: bigint;
  verificationTaskText: string;
  isActive: boolean;
  registeredAt: Date;
  lastWelcomeMessageId: bigint | null;
  portalInviteLink: string | null;
  rules: string[];
}

function mapGroup(r: Record<string, unknown>): GroupRow {
  return {
    groupId: r.group_id as number,
    tgGroupId: BigInt(r.tg_group_id as string | bigint),
    groupTitle: (r.group_title as string | null) ?? null,
    ownerWallet: r.owner_wallet as string,
    ownerTgId: BigInt(r.owner_tg_id as string | bigint),
    verificationTaskText: r.verification_task_text as string,
    isActive: r.is_active as boolean,
    registeredAt: r.registered_at as Date,
    lastWelcomeMessageId:
      r.last_welcome_message_id != null
        ? BigInt(r.last_welcome_message_id as string | bigint)
        : null,
    portalInviteLink: (r.portal_invite_link as string | null) ?? null,
    rules: (r.rules as string[] | null) ?? [],
  };
}

export async function registerGroup(input: {
  tgGroupId: bigint;
  ownerWallet: string;
  ownerTgId: bigint;
  verificationTaskText: string;
  groupTitle?: string;
}): Promise<GroupRow> {
  const res = await db.query(
    `INSERT INTO groups (tg_group_id, owner_wallet, owner_tg_id, verification_task_text, group_title)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tg_group_id) DO UPDATE SET
       owner_wallet = EXCLUDED.owner_wallet,
       owner_tg_id = EXCLUDED.owner_tg_id,
       verification_task_text = EXCLUDED.verification_task_text,
       group_title = COALESCE(EXCLUDED.group_title, groups.group_title),
       is_active = true
     RETURNING *`,
    [
      input.tgGroupId.toString(),
      input.ownerWallet.toLowerCase(),
      input.ownerTgId.toString(),
      input.verificationTaskText,
      input.groupTitle ?? null,
    ],
  );
  return mapGroup(res.rows[0]!);
}

export async function getGroupByTgId(tgGroupId: bigint): Promise<GroupRow | null> {
  const res = await db.query(`SELECT * FROM groups WHERE tg_group_id = $1`, [
    tgGroupId.toString(),
  ]);
  if (!res.rows[0]) return null;
  return mapGroup(res.rows[0]);
}

export async function getGroupById(groupId: number): Promise<GroupRow | null> {
  const res = await db.query(`SELECT * FROM groups WHERE group_id = $1`, [groupId]);
  if (!res.rows[0]) return null;
  return mapGroup(res.rows[0]);
}

export async function listActiveGroups(): Promise<GroupRow[]> {
  const res = await db.query(`SELECT * FROM groups WHERE is_active = true ORDER BY group_id`);
  return res.rows.map(mapGroup);
}

export async function pauseGroup(groupId: number): Promise<void> {
  await db.query(`UPDATE groups SET is_active = false WHERE group_id = $1`, [groupId]);
}

export async function resumeGroup(groupId: number): Promise<void> {
  await db.query(`UPDATE groups SET is_active = true WHERE group_id = $1`, [groupId]);
}

export async function getGroupsByOwnerTgId(ownerTgId: bigint): Promise<GroupRow[]> {
  const res = await db.query(
    `SELECT * FROM groups WHERE owner_tg_id = $1 AND is_active = true ORDER BY group_id`,
    [ownerTgId.toString()],
  );
  return res.rows.map(mapGroup);
}

export async function updateOwnerWallet(ownerTgId: bigint, wallet: string): Promise<number> {
  const res = await db.query(
    `UPDATE groups SET owner_wallet = $2 WHERE owner_tg_id = $1`,
    [ownerTgId.toString(), wallet.toLowerCase()],
  );
  return res.rowCount ?? 0;
}

export async function updatePortalInviteLink(
  groupId: number,
  inviteLink: string,
): Promise<void> {
  await db.query(`UPDATE groups SET portal_invite_link = $2 WHERE group_id = $1`, [
    groupId,
    inviteLink,
  ]);
}

export async function updateGroupRules(groupId: number, rules: string[]): Promise<void> {
  await db.query(`UPDATE groups SET rules = $2 WHERE group_id = $1`, [
    groupId,
    JSON.stringify(rules),
  ]);
}

export async function updateLastWelcomeMessageId(
  groupId: number,
  messageId: number | null,
): Promise<void> {
  await db.query(`UPDATE groups SET last_welcome_message_id = $2 WHERE group_id = $1`, [
    groupId,
    messageId,
  ]);
}

export interface GroupOwnerGroupStats {
  groupId: number;
  tgGroupId: string;
  groupTitle: string | null;
  isActive: boolean;
  portalInviteLink: string | null;
  totalVerifications: number;
  pendingEarnings: number;
  topBid: number | null;
}

export async function getGroupOwnerStats(ownerWallet: string): Promise<GroupOwnerGroupStats[]> {
  const res = await db.query(
    `SELECT
       g.group_id,
       g.tg_group_id::TEXT AS tg_group_id,
       g.group_title,
       g.is_active,
       g.portal_invite_link,
       COALESCE(v_stats.total_verifications, 0)::INT AS total_verifications,
       COALESCE(v_stats.pending_earnings_micro, 0)::BIGINT AS pending_earnings_micro,
       ab.bid_per_verification AS top_bid_micro
     FROM groups g
     LEFT JOIN (
       SELECT
         group_id,
         COUNT(*) FILTER (WHERE state = 'PASSED') AS total_verifications,
         SUM(locked_bid_price) FILTER (WHERE state = 'PASSED' AND locked_bid_price IS NOT NULL) AS pending_earnings_micro
       FROM verifications
       GROUP BY group_id
     ) v_stats ON v_stats.group_id = g.group_id
     LEFT JOIN LATERAL (
       SELECT bid_per_verification
       FROM advertiser_budgets
       WHERE group_id = g.group_id
         AND campaign_status = 'active'
         AND remaining_budget > 0
       ORDER BY bid_per_verification DESC
       LIMIT 1
     ) ab ON true
     WHERE g.owner_wallet = $1 AND g.is_active = true
     ORDER BY g.group_id`,
    [ownerWallet.toLowerCase()],
  );

  return res.rows.map((row) => ({
    groupId: row.group_id as number,
    tgGroupId: row.tg_group_id as string,
    groupTitle: (row.group_title as string | null) ?? null,
    isActive: row.is_active as boolean,
    portalInviteLink: (row.portal_invite_link as string | null) ?? null,
    totalVerifications: Number(row.total_verifications),
    pendingEarnings: fromMicroUnits(BigInt(row.pending_earnings_micro ?? 0)),
    topBid: row.top_bid_micro != null ? fromMicroUnits(BigInt(row.top_bid_micro as string)) : null,
  }));
}
