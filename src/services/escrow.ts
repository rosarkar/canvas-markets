import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";

const ESCROW_ADDRESS = "0x262ac1a082fd32c83e9b32ff1912ea070ed55890" as const;

// NOTE: function name "releasePayout" is inferred from decompiled bytecode.
// The deployed selector for this ABI must equal 0x3455e187.
// If txs revert with "function not found", confirm actual name with Mateo.
const ESCROW_ABI = [
  {
    type: "function",
    name: "releasePayout",
    inputs: [
      { type: "uint256", name: "advertiserId" },
      { type: "address", name: "recipient" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/**
 * Release USDC from escrow to the group owner after a successful verification.
 * Called fire-and-forget — errors are logged but do not block user admission.
 *
 * @param advertiserId - DB advertiser_id (matches contract's campaign key)
 * @param recipientAddress - Group owner's wallet (hex)
 * @param amountMicroUnits - Locked bid price in USDC microunits (6 decimals)
 */
export async function releaseEscrowPayout(
  advertiserId: number,
  recipientAddress: string,
  amountMicroUnits: bigint,
): Promise<string | null> {
  const pk = config.base.relayerPrivateKey;
  if (!pk) {
    logger.warn({ advertiserId }, "Escrow payout skipped — RELAYER_PRIVATE_KEY not set");
    return null;
  }

  try {
    const key = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
    const account = privateKeyToAccount(key);
    const client = createWalletClient({
      account,
      chain: base,
      transport: http(config.base.rpcUrl),
    });

    const txHash = await client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "releasePayout",
      args: [BigInt(advertiserId), recipientAddress as `0x${string}`, amountMicroUnits],
    });

    logger.info(
      {
        advertiserId,
        recipientAddress,
        amountMicroUnits: amountMicroUnits.toString(),
        txHash,
      },
      "Escrow payout released",
    );
    return txHash;
  } catch (err) {
    logger.error({ advertiserId, recipientAddress, err }, "Escrow payout failed");
    return null;
  }
}
