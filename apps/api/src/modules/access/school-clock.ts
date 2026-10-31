import type { Db } from "@idrok/db";
import { DEFAULT_SCHOOL_TZ, schoolToday, type SchoolDate } from "@idrok/shared/time";

/** The tenant's timezone and today's school date (CLAUDE.md §4: dates are computed on the server). */
export async function schoolClock(db: Db): Promise<{ timezone: string; today: SchoolDate }> {
  const settings = await db.schoolSettings.findFirst({ select: { timezone: true } });
  const timezone = settings?.timezone ?? DEFAULT_SCHOOL_TZ;
  return { timezone, today: schoolToday(timezone) };
}
