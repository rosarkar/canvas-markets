import type { NextFunction, Request, Response } from "express";
import { createPublicClient, http, isAddress, type Address, type Hex } from "viem";
import { base } from "viem/chains";

import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";

/** Signatures older (or future-dated further) than this are rejected to limit replay. */
export const AUTH_WINDOW_MS = 5 * 60_000;

/** The exact message the client must sign. Timestamp is Unix epoch milliseconds. */
export function buildAuthMessage(timestampMs: number): string {
  return `Canvas auth: ${timestampMs}`;
}

// Public-client verifyMessage (not the pure-ECDSA util): advertisers fund via
// Coinbase smart wallets, which sign per ERC-1271/6492 — verifying those requires an
// eth_call against the wallet contract, which the client action handles for EOAs and
// smart wallets alike.
const publicClient = createPublicClient({
  chain: base,
  transport: http(config.base.rpcUrl),
});

/**
 * Express middleware: proves the caller controls the wallet they're querying.
 *
 * Expects on the request (headers preferred, query accepted):
 * - `wallet` query param — the address being queried (unchanged from before)
 * - `x-canvas-timestamp` header or `ts` query — epoch ms used in the signed message
 * - `x-canvas-signature` header or `sig` query — signature of `Canvas auth: <ts>`
 */
export async function requireWalletAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const wallet = req.query.wallet as string | undefined;
  if (!wallet || !isAddress(wallet)) {
    res.status(400).json({ error: "Invalid or missing wallet address" });
    return;
  }

  const tsRaw =
    (req.headers["x-canvas-timestamp"] as string | undefined) ??
    (req.query.ts as string | undefined);
  const sig =
    (req.headers["x-canvas-signature"] as string | undefined) ??
    (req.query.sig as string | undefined);

  if (!tsRaw || !sig) {
    res.status(401).json({
      error: `Signature required: sign "${buildAuthMessage(Date.now())}" (current timestamp) with this wallet and pass ts + sig`,
    });
    return;
  }

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) {
    res.status(401).json({ error: "Invalid timestamp" });
    return;
  }
  if (Math.abs(Date.now() - ts) > AUTH_WINDOW_MS) {
    res.status(401).json({ error: "Signature expired — timestamp must be within 5 minutes" });
    return;
  }

  if (!/^0x[0-9a-fA-F]+$/.test(sig)) {
    res.status(401).json({ error: "Invalid signature format" });
    return;
  }

  try {
    const valid = await publicClient.verifyMessage({
      address: wallet as Address,
      message: buildAuthMessage(ts),
      signature: sig as Hex,
    });
    if (!valid) {
      res.status(401).json({ error: "Signature does not match wallet" });
      return;
    }
  } catch (err) {
    // RPC failure, not a bad signature — fail closed but say why.
    logger.error({ err, wallet }, "Wallet auth verification errored");
    res.status(503).json({ error: "Signature verification temporarily unavailable — try again" });
    return;
  }

  next();
}
