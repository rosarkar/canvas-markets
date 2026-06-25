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

// Behavioral rules read as directives/prohibitions ("no X", "don't X", "be X") — these are strong
// signals a line is an actual community rule, regardless of the group's specific topic.
const RULE_SIGNAL_PATTERNS: RegExp[] = [
  /\bno\b/i,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\bmust(?: not)?\b/i,
  /\bplease\b/i,
  /\bkeep\b/i,
  /\bavoid\b/i,
  /\brespect(ful)?\b/i,
  /\ballowed\b/i,
  /\bprohibit/i,
  /\bviolat/i,
  /\bself-?promo/i,
  /\bspam\b/i,
  /\bunsolicited\b/i,
  /\bharass/i,
  /\bkick(ed)?\b/i,
  /\bban(ned)?\b/i,
  /\bwarn(ing)?\b/i,
  /\bcivil\b/i,
  /\benglish only\b/i,
  /\bstay on topic\b/i,
  /\b(links?|dms?) (allowed|required|only)\b/i,
];

// Strong signals a line is general market/news commentary rather than a community rule, even
// though it may still arrive as syntactically valid JSON.
const OFF_TOPIC_SIGNAL_PATTERNS: RegExp[] = [
  /\$\d/,
  /\bprice\b/i,
  /\btrading\b/i,
  /\bbullish\b/i,
  /\bbearish\b/i,
  /\bpump(ing)?\b/i,
  /\bdump(ing)?\b/i,
  /\ball-?time high\b/i,
  /\bath\b/,
  /\bmarket cap\b/i,
  /\bbreaking news\b/i,
  /\bdominance\b/i,
  /\bapy\b/i,
  /\binterest rate/i,
  /\bforecast\b/i,
  /\bprediction\b/i,
];

function looksLikeCommunityRule(rule: string): boolean {
  if (RULE_SIGNAL_PATTERNS.some((p) => p.test(rule))) return true;
  if (OFF_TOPIC_SIGNAL_PATTERNS.some((p) => p.test(rule))) return false;
  // Ambiguous phrasing with no clear off-topic signal — give the benefit of the doubt rather
  // than risk false-rejecting a legitimately but unusually worded rule.
  return true;
}

/**
 * Lightweight, keyword-based relevance check — not a second Kimi call. Rejects a draft only when
 * EVERY rule in it reads as general content (price/news/unrelated advice) rather than a community
 * rule, so a single odd-but-real rule mixed in with good ones won't trigger a false rejection.
 */
export function isOffTopicRulesDraft(rules: string[]): boolean {
  if (rules.length === 0) return false;
  return rules.every((rule) => !looksLikeCommunityRule(rule));
}

const OFF_TOPIC_RETRY_INSTRUCTION: KimiMessage = {
  role: "system",
  content:
    'Your previous response did not look like community management rules — it read as general commentary, price/market discussion, or unrelated advice. Return ONLY a JSON object {"rules": [...]} of specific, practical community-management rules for this Telegram group (covering things like spam, self-promotion, scam links, tone — whatever fits what the owner described). Never return market commentary, price talk, or news.',
};

/** Drafts or revises a rule set from the full conversation history (system prompt is added here). */
export async function draftOrReviseRules(history: KimiMessage[]): Promise<string[]> {
  const content = await callKimi([{ role: "system", content: SYSTEM_PROMPT }, ...history], {
    temperature: 0.4,
    timeoutMs: 10_000,
  });
  const rules = parseRulesResponse(content);
  if (!isOffTopicRulesDraft(rules)) return rules;

  // Off-topic content slipped past the format check — retry once with an explicit corrective
  // instruction instead of showing it to the owner. Only happens on this failure path, not every turn.
  const retryContent = await callKimi(
    [{ role: "system", content: SYSTEM_PROMPT }, ...history, OFF_TOPIC_RETRY_INSTRUCTION],
    { temperature: 0.2, timeoutMs: 10_000 },
  );
  const retryRules = parseRulesResponse(retryContent);
  if (isOffTopicRulesDraft(retryRules)) {
    throw new Error("Kimi returned off-topic content twice in a row");
  }
  return retryRules;
}
