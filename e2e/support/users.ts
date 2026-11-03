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
} as const;

export const PORTS = { api: 4310, web: 3310 } as const;
export const WEB_URL = `http://localhost:${PORTS.web}`;
export const API_URL = `http://localhost:${PORTS.api}/api/v1`;
