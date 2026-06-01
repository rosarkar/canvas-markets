import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";

const DEFI_KEYWORDS = [
  "defi",
  "liquidity",
  "yield",
  "pool",
  "wallet",
  "staking",
  "lend",
  "borrow",
  "bridge",
  "swap",
  "base",
  "usdc",
  "eth",
  "token",
  "vault",
  "farm",
  "apr",
  "apy",
  "dex",
  "cefi",
  "onchain",
  "smart contract",
  "protocol",
  "moonwell",
  "aerodrome",
];

export interface ScoreResult {
  score: number;
  method: "kimi" | "keyword" | "manual";
}

/** Keyword fallback: ≥2 domain terms from curated list. */
export function scoreWithKeywords(taskText: string, responseText: string): ScoreResult {
  const combined = `${taskText} ${responseText}`.toLowerCase();
  const hits = DEFI_KEYWORDS.filter((kw) => combined.includes(kw) || responseText.toLowerCase().includes(kw));
  const uniqueInResponse = DEFI_KEYWORDS.filter((kw) => responseText.toLowerCase().includes(kw));
  const score = uniqueInResponse.length >= 2 ? 75 : uniqueInResponse.length === 1 ? 40 : 10;
  return { score, method: "keyword" };
}

/** Kimi API scoring — primary path per design doc. */
export async function scoreWithKimi(taskText: string, responseText: string): Promise<ScoreResult> {
  if (!config.kimi.apiKey) {
    logger.warn("KIMI_API_KEY not set — falling back to keyword scoring");
    return scoreWithKeywords(taskText, responseText);
  }

  const systemPrompt =
    'You are scoring a human verification response. The user was asked a question to prove they are a genuine member of a DeFi community, not a bot or spam account. Score their response from 0 to 100: 100 = clearly genuine and thoughtful, 0 = empty, random characters, or obviously evasive. Return only a JSON object: {"score": <integer 0-100>}.';

  const userMessage = `Question: ${taskText}\n\nResponse: ${responseText}`;

  try {
    const res = await fetch(`${config.kimi.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.kimi.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.kimi.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) throw new Error(`Kimi HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { score?: number };
    const score = Math.max(0, Math.min(100, Math.round(parsed.score ?? 0)));
    return { score, method: "kimi" };
  } catch (err) {
    logger.warn({ err }, "Kimi scoring failed — keyword fallback");
    return scoreWithKeywords(taskText, responseText);
  }
}

export function passesThreshold(result: ScoreResult): boolean {
  const threshold = config.constants.KIMI_PASS_THRESHOLD;
  if (threshold <= 0) return result.score >= 50;
  return result.score >= threshold;
}
