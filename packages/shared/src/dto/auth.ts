import { z } from "zod";
import { PERMISSION_CODES } from "../permissions";

export const ClientTypeSchema = z.enum(["WEB", "MOBILE", "TELEGRAM"]);

export const LoginRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
    clientType: ClientTypeSchema.default("WEB"),
    /** School slug; optional while there is one school. */
    tenant: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({ refreshToken: z.string().min(1).max(200).optional() }).strict();

export const PASSWORD_MIN_LENGTH = 8;
export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200),
  })
  .strict();
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const ThemeModeSchema = z.enum(["LIGHT", "DARK", "SYSTEM"]);
export const LocaleSchema = z.enum(["uz", "ru"]);

export const PreferencesSchema = z.object({
  themeMode: ThemeModeSchema,
  sidebarCollapsed: z.boolean(),
  density: z.enum(["COMFORTABLE", "COMPACT"]),
  locale: LocaleSchema.nullable(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const UpdatePreferencesSchema = PreferencesSchema.partial().strict();

export const MeSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  mustChangePassword: z.boolean(),
  roles: z.array(z.string()),
  permissions: z.array(z.enum(PERMISSION_CODES as [string, ...string[]])),
  tenant: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  profiles: z.object({
    studentId: z.uuid().nullable(),
    guardianId: z.uuid().nullable(),
    employeeId: z.uuid().nullable(),
  }),
  preferences: PreferencesSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  refreshToken: z.string().optional(),
});

export const LoginResponseSchema = z.object({ user: MeSchema, tokens: TokenPairSchema.optional() });

export const SessionSchema = z.object({
  id: z.uuid(),
  clientType: ClientTypeSchema,
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;
