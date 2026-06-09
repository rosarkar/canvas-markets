import { db } from "@/db.js";

export interface GroupRow {
  groupId: number;
  tgGroupId: bigint;
  ownerWallet: string;
  ownerTgId: bigint;
  verificationTaskText: string;
  isActive: boolean;
  registeredAt: Date;
}

function mapGroup(r: Record<string, unknown>): GroupRow {
  return {
    groupId: r.group_id as number,
    tgGroupId: BigInt(r.tg_group_id as string | bigint),
    ownerWallet: r.owner_wallet as string,
    ownerTgId: BigInt(r.owner_tg_id as string | bigint),
    verificationTaskText: r.verification_task_text as string,
    isActive: r.is_active as boolean,
    registeredAt: r.registered_at as Date,
  };
}

export async function registerGroup(input: {
  tgGroupId: bigint;
  ownerWallet: string;
  ownerTgId: bigint;
  verificationTaskText: string;
}): Promise<GroupRow> {
  const res = await db.query(
    `INSERT INTO groups (tg_group_id, owner_wallet, owner_tg_id, verification_task_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tg_group_id) DO UPDATE SET
       owner_wallet = EXCLUDED.owner_wallet,
       owner_tg_id = EXCLUDED.owner_tg_id,
       verification_task_text = EXCLUDED.verification_task_text,
       is_active = true
     RETURNING *`,
    [
      input.tgGroupId.toString(),
      input.ownerWallet.toLowerCase(),
      input.ownerTgId.toString(),
      input.verificationTaskText,
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

export async function updateOwnerWallet(ownerTgId: bigint, wallet: string): Promise<number> {
  const res = await db.query(
    `UPDATE groups SET owner_wallet = $2 WHERE owner_tg_id = $1`,
    [ownerTgId.toString(), wallet.toLowerCase()],
  );
  return res.rowCount ?? 0;
}
