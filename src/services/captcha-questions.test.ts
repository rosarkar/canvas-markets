import { describe, expect, it } from "vitest";

import {
  buildCaptchaCallbackData,
  parseCaptchaCallbackData,
  pickRandomCaptcha,
} from "./captcha-questions.js";

describe("captcha DM callback contract", () => {
  it("round-trips verification id and option in callback_data", () => {
    const verificationId = "550e8400-e29b-41d4-a716-446655440000";
    const data = buildCaptchaCallbackData(verificationId, "green");
    expect(parseCaptchaCallbackData(data)).toEqual({
      verificationId,
      optionId: "green",
    });
  });

  it("fits Telegram callback_data limit for uuid options", () => {
    const verificationId = "550e8400-e29b-41d4-a716-446655440000";
    const data = buildCaptchaCallbackData(verificationId, "yellow");
    expect(data.length).toBeLessThanOrEqual(64);
  });

  it("deep link payload fits Telegram /start limit", () => {
    const verificationId = "550e8400-e29b-41d4-a716-446655440000";
    const payload = `verify_${verificationId}`;
    expect(payload.length).toBeLessThanOrEqual(64);
  });

  it("pickRandomCaptcha returns a valid question", () => {
    const q = pickRandomCaptcha();
    expect(q.options.length).toBeGreaterThanOrEqual(2);
    expect(q.options.some((o) => o.id === q.correctOptionId)).toBe(true);
  });
});
