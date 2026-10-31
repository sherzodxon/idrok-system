import { z } from "zod";
import { isHexColor } from "../color";

const Hex = z.string().refine(isHexColor, { message: "invalid_color" });
export const ThemeModeValues = ["LIGHT", "DARK", "SYSTEM"] as const;

/** Public branding: what the login page and the CSS variables need. */
export const BrandingSchema = z.object({
  schoolName: z.string(),
  platformName: z.string(),
  primaryColor: z.string(),
  primaryHoverColor: z.string(),
  primaryStrongColor: z.string(),
  primarySoftColor: z.string(),
  secondaryColor: z.string().nullable(),
  defaultThemeMode: z.enum(ThemeModeValues),
  defaultLocale: z.enum(["uz", "ru"]),
});
export type Branding = z.infer<typeof BrandingSchema>;

export const UpdateBrandingSchema = z
  .object({
    schoolName: z.string().trim().min(1).max(120),
    platformName: z.string().trim().min(1).max(60),
    primaryColor: Hex,
    /** Omitted shades are derived from primaryColor. */
    primaryHoverColor: Hex.nullable(),
    primaryStrongColor: Hex.nullable(),
    primarySoftColor: Hex.nullable(),
    secondaryColor: Hex.nullable(),
    defaultThemeMode: z.enum(ThemeModeValues),
  })
  .partial()
  .strict();

export const BrandingUpdatedSchema = z.object({
  branding: BrandingSchema,
  /** e.g. LOW_CONTRAST: white text on the primary colour is hard to read (WCAG AA < 4.5:1). */
  warnings: z.array(z.object({ code: z.string(), params: z.record(z.string(), z.unknown()).optional() })),
});

export const SchoolSettingsSchema = z.object({
  timezone: z.string(),
  defaultLocale: z.enum(["uz", "ru"]),
  weekStartsOn: z.number().int(),
  studentAccountMinGrade: z.number().int(),
  planApprovalRequired: z.boolean(),
});
export type SchoolSettingsDto = z.infer<typeof SchoolSettingsSchema>;

export const UpdateSchoolSettingsSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    defaultLocale: z.enum(["uz", "ru"]),
    weekStartsOn: z.number().int().min(1).max(7),
    studentAccountMinGrade: z.number().int().min(0).max(11),
    planApprovalRequired: z.boolean(),
  })
  .partial()
  .strict();
