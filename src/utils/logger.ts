import pino from "pino";

import { config } from "@/config/config.js";

const isProd = config.env === "production";

export const logger = pino({
  level: "info",

  redact: {
    paths: ["req.headers.authorization", "password", "token", "secret"],
    remove: true,
  },

  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
});
