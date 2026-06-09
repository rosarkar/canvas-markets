import { Bot } from "grammy";

/** DM text handler — reserved for future /register and /buy conversation flows. */
export function registerMessageHandler(_bot: Bot): void {
  // Join verification uses in-group MCQ captcha callbacks, not DM text.
}
