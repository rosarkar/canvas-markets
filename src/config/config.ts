import "@/load-env.js";

const requireEnv = (name: string, value?: string): string => {
  if (!value) throw new Error(`${name} is required in .env`);
  return value;
};

interface Config {
  env: string;
  databaseUrl: string;
  telegram: {
    botToken: string;
    webhookUrl: string;
    webhookSecret: string;
    webhookPort: number;
  };
  kimi: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  base: {
    rpcUrl: string;
    relayerPrivateKey: string;
  };
  openai: {
    apiKey: string;
  };
  constants: {
    /** Calibrated after founder review of first ~50 responses; placeholder until then. */
    KIMI_PASS_THRESHOLD: number;
    VERIFICATION_TTL_MS: number;
    COOLDOWN_MS: number;
    MIN_BID_MICROUNITS: bigint;
  };
}

export const config: Config = {
  env: process.env.NODE_ENV ?? "development",
  databaseUrl: requireEnv("DATABASE_URL", process.env.DATABASE_URL),
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN?.trim()),
    webhookUrl: requireEnv("TELEGRAM_WEBHOOK_URL", process.env.TELEGRAM_WEBHOOK_URL?.trim()),
    webhookSecret: requireEnv(
      "TELEGRAM_WEBHOOK_SECRET",
      process.env.TELEGRAM_WEBHOOK_SECRET?.trim(),
    ),
    webhookPort: parseInt(process.env.PORT ?? "3000", 10),
  },
  kimi: {
    apiKey: process.env.KIMI_API_KEY?.trim() ?? "",
    baseUrl: process.env.KIMI_BASE_URL?.trim() ?? "https://api.moonshot.cn/v1",
    model: process.env.KIMI_MODEL?.trim() ?? "moonshot-v1-8k",
  },
  base: {
    rpcUrl: process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org",
    relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY?.trim() ?? "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
  },
  constants: {
    KIMI_PASS_THRESHOLD: Number(process.env.KIMI_PASS_THRESHOLD ?? "0"),
    VERIFICATION_TTL_MS: 300_000,
    COOLDOWN_MS: 86_400_000,
    MIN_BID_MICROUNITS: 100_000n,
  },
};
