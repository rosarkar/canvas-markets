export interface CaptchaOption {
  id: string;
  label: string;
}

export interface CaptchaQuestion {
  id: string;
  prompt: string;
  options: CaptchaOption[];
  correctOptionId: string;
}

const CAPTCHA_QUESTIONS: CaptchaQuestion[] = [
  {
    id: "apple-color",
    prompt: "What color is an apple?",
    options: [
      { id: "green", label: "Green" },
      { id: "blue", label: "Blue" },
    ],
    correctOptionId: "green",
  },
  {
    id: "two-plus-two",
    prompt: "What is 2 + 2?",
    options: [
      { id: "four", label: "4" },
      { id: "five", label: "5" },
    ],
    correctOptionId: "four",
  },
  {
    id: "days-in-week",
    prompt: "How many days are in a week?",
    options: [
      { id: "seven", label: "7" },
      { id: "eight", label: "8" },
    ],
    correctOptionId: "seven",
  },
  {
    id: "sun-color",
    prompt: "What color is the sun?",
    options: [
      { id: "yellow", label: "Yellow" },
      { id: "purple", label: "Purple" },
    ],
    correctOptionId: "yellow",
  },
  {
    id: "water-state",
    prompt: "At room temperature, water is a…",
    options: [
      { id: "liquid", label: "Liquid" },
      { id: "solid", label: "Solid" },
    ],
    correctOptionId: "liquid",
  },
  {
    id: "months-in-year",
    prompt: "How many months are in a year?",
    options: [
      { id: "twelve", label: "12" },
      { id: "ten", label: "10" },
    ],
    correctOptionId: "twelve",
  },
  {
    id: "sky-color",
    prompt: "On a clear day, the sky is usually…",
    options: [
      { id: "blue", label: "Blue" },
      { id: "red", label: "Red" },
    ],
    correctOptionId: "blue",
  },
  {
    id: "banana-color",
    prompt: "What color is a ripe banana?",
    options: [
      { id: "yellow", label: "Yellow" },
      { id: "green", label: "Green" },
    ],
    correctOptionId: "yellow",
  },
  {
    id: "hours-in-day",
    prompt: "How many hours are in a day?",
    options: [
      { id: "twentyfour", label: "24" },
      { id: "twelve", label: "12" },
    ],
    correctOptionId: "twentyfour",
  },
  {
    id: "ice-temp",
    prompt: "Does ice melt when it gets warmer?",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
    correctOptionId: "yes",
  },
];

export function pickRandomCaptcha(): CaptchaQuestion {
  const index = Math.floor(Math.random() * CAPTCHA_QUESTIONS.length);
  return CAPTCHA_QUESTIONS[index]!;
}

export function getCaptchaById(id: string): CaptchaQuestion | undefined {
  return CAPTCHA_QUESTIONS.find((q) => q.id === id);
}

export function buildCaptchaCallbackData(verificationId: string, optionId: string): string {
  return `captcha:${verificationId}:${optionId}`;
}

export function parseCaptchaCallbackData(
  data: string,
): { verificationId: string; optionId: string } | null {
  if (!data.startsWith("captcha:")) return null;
  const parts = data.split(":");
  if (parts.length !== 3) return null;
  const verificationId = parts[1];
  const optionId = parts[2];
  if (!verificationId || !optionId) return null;
  return { verificationId, optionId };
}
