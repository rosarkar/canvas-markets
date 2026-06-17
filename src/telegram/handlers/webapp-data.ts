/** Parse JSON payload from Telegram Mini App sendData(). */
export function parseWebAppData(
  raw: string,
): { verificationId: string; optionId: string; optionLabel: string } | null {
  try {
    const data = JSON.parse(raw) as {
      verificationId?: string;
      optionId?: string;
      optionLabel?: string;
    };
    if (!data.verificationId || !data.optionId) return null;
    return {
      verificationId: data.verificationId,
      optionId: data.optionId,
      optionLabel: data.optionLabel ?? data.optionId,
    };
  } catch {
    return null;
  }
}
