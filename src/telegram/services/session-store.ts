import { db } from "@/db.js";
import { logger } from "@/utils/logger.js";

/** Dual-identity session: which mode is active and, for owners, which group. */
export type SessionState = { mode: "owner" | "advertiser"; activeTgGroupId?: bigint };

/**
 * Postgres-backed session store with a write-through in-memory cache.
 *
 * Railway restarts the process on every deploy, which used to wipe the in-memory
 * session Map and log every user out of their flow (BUILD.md deferred item). Sessions
 * now persist in user_sessions; the cache keeps the hot path free of per-update DB
 * reads. DB errors degrade to "no session" — the same behavior as the old Map after
 * a restart — and never break a handler.
 */
const cache = new Map<number, SessionState | null>();

export async function getSession(fromId: number): Promise<SessionState | undefined> {
  if (cache.has(fromId)) return cache.get(fromId) ?? undefined;
  try {
    const res = await db.query<{ mode: string; active_tg_group_id: string | null }>(
      `SELECT mode, active_tg_group_id::TEXT AS active_tg_group_id
       FROM user_sessions WHERE tg_user_id = $1`,
      [fromId.toString()],
    );
    const row = res.rows[0];
    const state: SessionState | null = row
      ? {
          mode: row.mode as SessionState["mode"],
          activeTgGroupId: row.active_tg_group_id ? BigInt(row.active_tg_group_id) : undefined,
        }
      : null;
    cache.set(fromId, state);
    return state ?? undefined;
  } catch (err) {
    logger.warn({ err, fromId }, "Session load failed — treating as absent");
    return undefined;
  }
}

export async function setSession(fromId: number, state: SessionState): Promise<void> {
  cache.set(fromId, state);
  try {
    await db.query(
      `INSERT INTO user_sessions (tg_user_id, mode, active_tg_group_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tg_user_id) DO UPDATE
       SET mode = EXCLUDED.mode,
           active_tg_group_id = EXCLUDED.active_tg_group_id,
           updated_at = NOW()`,
      [fromId.toString(), state.mode, state.activeTgGroupId?.toString() ?? null],
    );
  } catch (err) {
    logger.warn({ err, fromId }, "Session persist failed — kept in memory only");
  }
}

export async function clearSession(fromId: number): Promise<void> {
  cache.set(fromId, null);
  try {
    await db.query(`DELETE FROM user_sessions WHERE tg_user_id = $1`, [fromId.toString()]);
  } catch (err) {
    logger.warn({ err, fromId }, "Session clear failed in DB — cleared in memory only");
  }
}
