import type { Db } from "@idrok/db";
import type { Me, Preferences } from "@idrok/shared";
import type { RequestAuth } from "../../http/auth";

const DEFAULT_PREFERENCES: Preferences = {
  themeMode: "SYSTEM",
  sidebarCollapsed: false,
  density: "COMFORTABLE",
  locale: null,
};

export class MeService {
  constructor(
    private readonly db: Db,
    private readonly features: Me["features"] = { telegram: false },
  ) {}

  async get(auth: RequestAuth): Promise<Me> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: {
        id: true,
        username: true,
        mustChangePassword: true,
        tenant: { select: { id: true, slug: true, name: true } },
        preference: { select: { themeMode: true, sidebarCollapsed: true, density: true, locale: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
        guardian: { select: { id: true, firstName: true, lastName: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const person = user.employee ?? user.student ?? user.guardian;
    return {
      id: user.id,
      username: user.username,
      displayName: person ? `${person.firstName} ${person.lastName}` : user.username,
      mustChangePassword: user.mustChangePassword && !auth.telegram,
      roles: auth.roles,
      permissions: auth.permissions,
      tenant: user.tenant,
      profiles: {
        studentId: user.student?.id ?? null,
        guardianId: user.guardian?.id ?? null,
        employeeId: user.employee?.id ?? null,
      },
      preferences: user.preference ?? DEFAULT_PREFERENCES,
      features: this.features,
    };
  }

  async updatePreferences(userId: string, patch: Partial<Preferences>): Promise<Preferences> {
    const saved = await this.db.userPreference.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
      select: { themeMode: true, sidebarCollapsed: true, density: true, locale: true },
    });
    return saved;
  }
}
