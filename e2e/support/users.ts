// Synthetic demo accounts (Q-30). One account per spec, so preferences changed by one test do not leak into another.
export const PASSWORD = "Demo-parol-2026";
export const TEMP_PASSWORD = "Vaqtinchalik-2026";

export const USERS = {
  firstLogin: "e2e.birinchi",
  theme: "e2e.mavzu",
  branding: "e2e.brend",
  sidebar: "e2e.menyu",
  mobile: "e2e.mobil",
  importer: "e2e.import",
  teacher: "e2e.ustoz",
  planner: "e2e.rejachi",
  guardian: "+998900000001",
  student: "e2e.oquvchi",
  coinAdmin: "e2e.coin",
  telegramAdmin: "e2e.telegram",
} as const;

export const PORTS = { api: 4310, web: 3310, telegram: 4320 } as const;
export const WEB_URL = `http://localhost:${PORTS.web}`;
export const API_URL = `http://localhost:${PORTS.api}/api/v1`;

// M7: a fake Bot API (support/telegram.ts) stands in for api.telegram.org. Not secrets: fixed values for e2e only.
export const TELEGRAM = {
  botToken: "424242:e2e-only-bot-token-not-a-secret-000000",
  webhookSecret: "e2e-only-webhook-secret-0123456789abcdef",
  botUsername: "idrok_e2e_bot",
  apiUrl: `http://localhost:${PORTS.telegram}`,
} as const;
