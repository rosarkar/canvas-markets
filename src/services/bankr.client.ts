import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";

const BANKR_API_BASE = "https://api.bankr.bot";

export type BankrJobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface BankrJobResult {
  jobId: string;
  status: BankrJobStatus;
  response?: string;
  error?: string;
}

export function isBankrConfigured(): boolean {
  return Boolean(config.payments.bankrApiKey);
}

export async function submitPrompt(prompt: string): Promise<string> {
  const apiKey = config.payments.bankrApiKey;
  if (!apiKey) throw new Error("BANKR_API_KEY is not set");

  const res = await fetch(`${BANKR_API_BASE}/agent/prompt`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bankr prompt failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { jobId?: string };
  if (!data.jobId) throw new Error("Bankr response missing jobId");
  return data.jobId;
}

export async function pollJob(jobId: string): Promise<BankrJobResult> {
  const apiKey = config.payments.bankrApiKey;
  if (!apiKey) throw new Error("BANKR_API_KEY is not set");

  const res = await fetch(`${BANKR_API_BASE}/agent/job/${jobId}`, {
    headers: { "X-API-Key": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bankr poll failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    status?: BankrJobStatus;
    response?: string;
    error?: string;
  };

  return {
    jobId,
    status: data.status ?? "pending",
    response: data.response,
    error: data.error,
  };
}

export async function runPrompt(
  prompt: string,
  options?: { maxWaitMs?: number; pollIntervalMs?: number },
): Promise<BankrJobResult> {
  const maxWaitMs = options?.maxWaitMs ?? 120_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 2_000;
  const jobId = await submitPrompt(prompt);
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const result = await pollJob(jobId);
    if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
      return result;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Bankr job ${jobId} timed out after ${maxWaitMs}ms`);
}

export async function queryBalance(): Promise<BankrJobResult> {
  logger.info("Bankr: querying Base USDC balance");
  return runPrompt("What is my USDC balance on Base?");
}
