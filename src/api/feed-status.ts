/**
 * Debug route — GET /api/feed-status
 *
 * Reports, from the *deployed* service, exactly why the board is live or on
 * sample fixtures: the USE_TXLINE flag, the subscription wallet's public key +
 * live devnet SOL balance, whether the wallet is ephemeral (no key set), how the
 * odds feed actually resolved this process, and the last feed error — plus a
 * live Polymarket (Gamma) probe so the empty-Polymarket case is explainable.
 *
 * No secret is exposed — only the public key + on-chain balance (both public).
 * Safe to remove after the hackathon.
 */
import { Router } from "express";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "@/config/index.js";
import { loadOrCreateKeypair } from "@/services/txline/wallet.js";
import { TXLINE_NETWORKS } from "@/services/txline/program.js";
import { resolveOddsFeed, getFeedStatus } from "@/services/odds-feed.js";
import { polymarketDiagnostics } from "@/services/polymarket.js";

export const feedStatusRouter = Router();

feedStatusRouter.get("/api/feed-status", async (_req, res) => {
  // Make sure a resolve has been attempted so the status reflects reality.
  // resolveOddsFeed() is idempotent (cached per process), so this is cheap.
  try {
    await resolveOddsFeed();
  } catch {
    /* the failure is captured in getFeedStatus().lastError */
  }
  const status = getFeedStatus();
  const net = TXLINE_NETWORKS[config.solana.network];

  const secretKeySet = config.solana.devnetSecretKey.trim().length > 0;
  const { keypair, ephemeral } = loadOrCreateKeypair(config.solana.devnetSecretKey);
  const pubkey = keypair.publicKey.toBase58();

  let balanceSol: number | null = null;
  let balanceError: string | null = null;
  try {
    const conn = new Connection(net.rpcUrl, "confirmed");
    balanceSol = (await conn.getBalance(keypair.publicKey)) / LAMPORTS_PER_SOL;
  } catch (err) {
    balanceError = (err as Error).message;
  }
  const funded = balanceSol != null && balanceSol >= 0.5;

  let pm: Awaited<ReturnType<typeof polymarketDiagnostics>> | { error: string };
  try {
    pm = await polymarketDiagnostics();
  } catch (err) {
    pm = { error: (err as Error).message };
  }

  let diagnosis: string;
  if (!status.useTxline) {
    diagnosis =
      "USE_TXLINE is not \"true\" — serving sample fixtures by design. Set USE_TXLINE=true on this service and redeploy.";
  } else if (ephemeral || !secretKeySet) {
    diagnosis =
      "USE_TXLINE=true but SOLANA_DEVNET_SECRET_KEY is missing/invalid — the service generated an ephemeral, unfunded wallet. Set the funded key (base58) and redeploy.";
  } else if (!funded) {
    diagnosis = `USE_TXLINE=true and the key is set, but wallet ${pubkey} holds ${
      balanceSol ?? "unknown"
    } SOL on ${config.solana.network} (need ≥ 0.5). Fund it, then restart the service.`;
  } else if (status.resolvedSource === "sample-fixtures") {
    diagnosis = `USE_TXLINE=true and the wallet is funded, but the live feed failed to initialise${
      status.lastError ? `: ${status.lastError}` : ""
    }. The feed choice is cached per process — restart/redeploy the service to retry.`;
  } else if (status.resolvedSource === "txline-live") {
    diagnosis = "Live TxLINE feed is active.";
  } else {
    diagnosis = "Feed not resolved yet (no board request has been served).";
  }

  res.json({
    ok: true,
    service: "canvas-markets",
    network: config.solana.network,
    rpcUrl: net.rpcUrl,
    apiOrigin: net.apiOrigin,
    useTxline: status.useTxline,
    wallet: {
      pubkey,
      secretKeySet,
      ephemeral,
      balanceSol,
      funded,
      balanceError,
      explorerUrl: `https://explorer.solana.com/address/${pubkey}?cluster=${config.solana.network}`,
    },
    feed: {
      resolved: status.resolved,
      resolvedSource: status.resolvedSource,
      resolvedAt: status.resolvedAt ? new Date(status.resolvedAt).toISOString() : null,
      lastError: status.lastError,
    },
    polymarket: pm,
    diagnosis,
    checkedAt: new Date().toISOString(),
  });
});
