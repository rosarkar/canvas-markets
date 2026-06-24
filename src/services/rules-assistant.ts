import { callKimi, type KimiMessage } from "@/services/scoring.js";

const SYSTEM_PROMPT = `You are an experienced Telegram community manager helping a group owner draft moderation rules for their crypto-native Telegram community.

Given the group's topic and what the owner says about their goals or problem behaviors, draft a rule set that is specific, practical, and appropriately strict for a crypto/DeFi audience — covering things like spam/self-promotion, unsolicited DMs, scam or phishing links, price speculation or alpha calls without context, and language/tone expectations, but ONLY where relevant to what the owner described. Don't pad the list with generic filler rules that don't fit their stated context. Aim for 3-7 rules.

When asked to revise, return the FULL updated rule list (not just the changed rule), incorporating the requested change.

Always respond with ONLY a JSON object of the shape {"rules": ["short rule sentence", ...]}. No markdown, no commentary, no text outside the JSON object. Each rule should be a short, standalone sentence suitable for a numbered list shown directly to end users.`;

export function buildInitialRulesPrompt(groupTitle: string, topic: string, ownerReply: string): string {
  return (
    `Group: "${groupTitle}"\n` +
    `Topic / focus: ${topic}\n\n` +
    `Owner's answer about what the group is for and any problem behaviors to prevent:\n${ownerReply}\n\n` +
    `Draft an initial rule set for this group.`
  );
}

export function formatRulesList(rules: string[]): string {
  return rules.map((rule, i) => `${i + 1}. ${rule}`).join("\n");
}

function parseRulesResponse(content: string): string[] {
  const parsed = JSON.parse(content) as { rules?: unknown };
  if (!Array.isArray(parsed.rules) || parsed.rules.some((r) => typeof r !== "string")) {
    throw new Error("Kimi returned a malformed rules payload");
  }
  const rules = (parsed.rules as string[]).map((r) => r.trim()).filter(Boolean);
  if (rules.length === 0) throw new Error("Kimi returned an empty rules list");
  return rules;
}

/** Drafts or revises a rule set from the full conversation history (system prompt is added here). */
export async function draftOrReviseRules(history: KimiMessage[]): Promise<string[]> {
  const content = await callKimi([{ role: "system", content: SYSTEM_PROMPT }, ...history], {
    temperature: 0.4,
    timeoutMs: 10_000,
  });
  return parseRulesResponse(content);
}
