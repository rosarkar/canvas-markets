import type { TaskOption } from "@/services/verification-tasks.js";

/** True when a free-text reply is too short/generic to be worth scoring as-is. */
export function isThinResponse(text: string, minLength = 20, minWords = 4): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return trimmed.length < minLength || words.length < minWords;
}

/**
 * Splits a "ranking, then reasoning" reply, e.g. "A, C, D, B — hits hardest because...".
 * Returns the ranking token list and whatever free text follows it (empty if none).
 */
export function extractRankingAndReasoning(text: string): {
  ranking: string | null;
  reasoning: string;
} {
  const trimmed = text.trim();
  const match = trimmed.match(/^((?:[A-Za-z0-9]+\s*,\s*)+[A-Za-z0-9]+)\s*(?:[—\-:]\s*)?(.*)$/s);
  if (!match) return { ranking: null, reasoning: trimmed };
  return { ranking: match[1]!.trim(), reasoning: (match[2] ?? "").trim() };
}

/**
 * Splits an "A — reasoning" / "B: reasoning" style reply against the task's two options.
 * Falls back to matching on the option's label text if no leading letter is found.
 */
export function extractOptionAndReasoning(
  text: string,
  options: TaskOption[],
): { optionId: string | null; reasoning: string } {
  const trimmed = text.trim();

  const letterMatch = trimmed.match(/^([A-Za-z])\b\s*(?:[—\-:]\s*)?(.*)$/s);
  if (letterMatch) {
    const index = letterMatch[1]!.toUpperCase().charCodeAt(0) - 65;
    const option = options[index];
    if (option) {
      return { optionId: option.id, reasoning: (letterMatch[2] ?? "").trim() };
    }
  }

  for (const option of options) {
    if (trimmed.toLowerCase().startsWith(option.label.toLowerCase())) {
      return {
        optionId: option.id,
        reasoning: trimmed.slice(option.label.length).replace(/^[\s\-—:]+/, "").trim(),
      };
    }
  }

  return { optionId: null, reasoning: trimmed };
}
