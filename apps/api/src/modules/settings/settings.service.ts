import { requireTenantId, type Db, type RootClient } from "@idrok/db";
import {
  contrastRatio,
  deriveBrandShades,
  type Branding,
  type SchoolSettingsDto,
  type UpdateBrandingSchema,
  type UpdateSchoolSettingsSchema,
} from "@idrok/shared";
import { isValidTimeZone } from "@idrok/shared/time";
import type { z } from "zod";
import { AppError, notFound } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";

const DEFAULTS = {
  platformName: "Idrok System",
  primaryColor: "#4E92CF",
  ...deriveBrandShades("#4E92CF"),
  secondaryColor: null,
  defaultThemeMode: "SYSTEM" as const,
};

type BrandingRow = Omit<Branding, "defaultLocale">;

const pick = (b: BrandingRow, defaultLocale: "uz" | "ru"): Branding => ({
  schoolName: b.schoolName,
  platformName: b.platformName,
  primaryColor: b.primaryColor,
  primaryHoverColor: b.primaryHoverColor,
  primaryStrongColor: b.primaryStrongColor,
  primarySoftColor: b.primarySoftColor,
  secondaryColor: b.secondaryColor,
  defaultThemeMode: b.defaultThemeMode,
  defaultLocale,
});

export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly root: RootClient,
  ) {}

  /** Public branding for the login page and CSS variables; works before login, so the tenant comes from its slug. */
  async publicBranding(slug: string): Promise<Branding> {
    const tenant = await this.root.tenant.findUnique({
      where: { slug },
      select: { name: true, status: true, branding: true, settings: { select: { defaultLocale: true } } },
    });
    if (!tenant || tenant.status !== "ACTIVE") throw notFound();
    return pick(tenant.branding ?? { schoolName: tenant.name, ...DEFAULTS }, tenant.settings?.defaultLocale ?? "uz");
  }

  async branding(): Promise<Branding> {
    const [b, s, tenant] = await Promise.all([
      this.db.schoolBranding.findFirst(),
      this.db.schoolSettings.findFirst({ select: { defaultLocale: true } }),
      this.root.tenant.findUniqueOrThrow({ where: { id: requireTenantId() }, select: { name: true } }),
    ]);
    return pick(b ?? { schoolName: tenant.name, ...DEFAULTS }, s?.defaultLocale ?? "uz");
  }

  async updateBranding(input: z.infer<typeof UpdateBrandingSchema>) {
    const current = await this.branding();
    const primary = input.primaryColor ?? current.primaryColor;
    // A new primary colour re-derives the shades the request does not set explicitly.
    const derived: Partial<ReturnType<typeof deriveBrandShades>> = input.primaryColor ? deriveBrandShades(primary) : {};
    const next = {
      schoolName: input.schoolName ?? current.schoolName,
      platformName: input.platformName ?? current.platformName,
      primaryColor: primary,
      primaryHoverColor: input.primaryHoverColor ?? derived.primaryHoverColor ?? current.primaryHoverColor,
      primaryStrongColor: input.primaryStrongColor ?? derived.primaryStrongColor ?? current.primaryStrongColor,
      primarySoftColor: input.primarySoftColor ?? derived.primarySoftColor ?? current.primarySoftColor,
      secondaryColor: input.secondaryColor === undefined ? current.secondaryColor : input.secondaryColor,
      defaultThemeMode: input.defaultThemeMode ?? current.defaultThemeMode,
    };
    await this.db.$transaction(async (tx) => {
      const existing = await tx.schoolBranding.findFirst({ select: { id: true } });
      if (existing) await tx.schoolBranding.update({ where: { id: existing.id }, data: next });
      else await tx.schoolBranding.create({ data: { tenantId: requireTenantId(), ...next } });
      await writeAudit(tx, {
        action: "settings.branding.update",
        entityType: "SchoolBranding",
        before: current,
        after: next,
      });
    });
    const ratio = contrastRatio(next.primaryColor, "#FFFFFF");
    const warnings = ratio < 4.5 ? [{ code: "LOW_CONTRAST", params: { ratio: Math.round(ratio * 100) / 100 } }] : [];
    return { branding: { ...next, defaultLocale: current.defaultLocale }, warnings };
  }

  async school(): Promise<SchoolSettingsDto> {
    const s = await this.db.schoolSettings.findFirst();
    return {
      timezone: s?.timezone ?? "Asia/Tashkent",
      defaultLocale: s?.defaultLocale ?? "uz",
      weekStartsOn: s?.weekStartsOn ?? 1,
      studentAccountMinGrade: s?.studentAccountMinGrade ?? 5,
      planApprovalRequired: s?.planApprovalRequired ?? true,
    };
  }

  async updateSchool(userId: string, input: z.infer<typeof UpdateSchoolSettingsSchema>) {
    if (input.timezone && !isValidTimeZone(input.timezone)) {
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "timezone", code: "invalid_timezone" }] });
    }
    const before = await this.school();
    await this.db.$transaction(async (tx) => {
      const existing = await tx.schoolSettings.findFirst({ select: { id: true } });
      if (existing)
        await tx.schoolSettings.update({ where: { id: existing.id }, data: { ...input, updatedById: userId } });
      else await tx.schoolSettings.create({ data: { tenantId: requireTenantId(), ...input, updatedById: userId } });
      await writeAudit(tx, { action: "settings.school.update", entityType: "SchoolSettings", before, after: input });
    });
    return this.school();
  }
}
