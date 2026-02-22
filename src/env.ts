import dotenv from "dotenv";
dotenv.config();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const env = {
  PORT: parseInt(process.env.PORT || "8080", 10),
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "8080"}`,

  DATABASE_URL: req("DATABASE_URL"),

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || "",

  INSTAGRAM_VERIFY_TOKEN: process.env.INSTAGRAM_VERIFY_TOKEN || "",
  INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET || "",

  INSTAGRAM_PAGE_ACCESS_TOKEN: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || "",
  // Meta "Page" id used for some APIs / debug (optional)
  INSTAGRAM_PAGE_ID: process.env.INSTAGRAM_PAGE_ID || "",

  // Required for conversations sync endpoint:
  // https://graph.facebook.com/<version>/<INSTAGRAM_PAGE_COMPANY_ID>/conversations?...&platform=instagram
  INSTAGRAM_PAGE_COMPANY_ID: process.env.INSTAGRAM_PAGE_COMPANY_ID || "",

  // Optional: helps determine inbound/outbound when syncing conversations.
  // If set, messages with from.id === INSTAGRAM_IG_USER_ID are treated as outbound.
  INSTAGRAM_IG_USER_ID: process.env.INSTAGRAM_IG_USER_ID || "",
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v25.0",
};
