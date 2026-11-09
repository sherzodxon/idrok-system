"use client";

// Reports centre (audit phase 6): one form (range, class) and a download per report the user may take. The files are
// built by the API from the same data the pages show.
import { CalendarCheck, Coins, Download, GraduationCap, UsersRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { PermissionCode } from "@idrok/shared";
import { addSchoolDays, diffSchoolDays, schoolToday, type SchoolDate } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { FilterSelect, PageHeader, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useClassGroups } from "@/lib/queries";
import { can, useMe } from "@/lib/use-me";
import { useErrorText } from "@/lib/use-error-text";

type Kind = "attendance" | "staff-attendance" | "scores" | "coins";
const REPORTS: { kind: Kind; permission: PermissionCode; icon: ReactNode; maxDays: number; byClass: boolean }[] = [
  {
    kind: "attendance",
    permission: "attendance.view",
    icon: <CalendarCheck className="size-5" />,
    maxDays: 92,
    byClass: true,
  },
  {
    kind: "staff-attendance",
    permission: "employees.view",
    icon: <UsersRound className="size-5" />,
    maxDays: 92,
    byClass: false,
  },
  {
    kind: "scores",
    permission: "assessment.view",
    icon: <GraduationCap className="size-5" />,
    maxDays: 366,
    byClass: true,
  },
  { kind: "coins", permission: "coins.view", icon: <Coins className="size-5" />, maxDays: 366, byClass: true },
];

function saveBlob({ blob, fileName }: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const t = useTranslations("reports");
  const locale = useLocale();
  const api = useApi();
  const me = useMe();
  const toast = useToast();
  const errorText = useErrorText();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const today = schoolToday();
  const [from, setFrom] = useState<SchoolDate>(addSchoolDays(today, -6));
  const [to, setTo] = useState<SchoolDate>(today);
  const [classGroupId, setClassGroupId] = useState("");
  const [busy, setBusy] = useState<Kind | null>(null);
  if (me.isPending) return <LoadingState />;
  const mine = REPORTS.filter((r) => can(me.data, r.permission));
  const days = diffSchoolDays(from, to);

  const download = async (r: (typeof REPORTS)[number]) => {
    setBusy(r.kind);
    try {
      const q = new URLSearchParams({ from, to, locale: locale === "ru" ? "ru" : "uz" });
      if (r.byClass && classGroupId) q.set("classGroupId", classGroupId);
      saveBlob(await api.download(`/reports/${r.kind}.xlsx?${q.toString()}`));
    } catch (err) {
      toast("error", errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card className="mb-4">
        <Toolbar>
          <Field label={t("from")}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={from}
                max={to}
                onChange={(e) => e.target.value && setFrom(e.target.value as SchoolDate)}
              />
            )}
          </Field>
          <Field label={t("to")}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => e.target.value && setTo(e.target.value as SchoolDate)}
              />
            )}
          </Field>
          <FilterSelect
            label={t("class")}
            allLabel={t("allClasses")}
            value={classGroupId}
            onChange={setClassGroupId}
            options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Toolbar>
      </Card>
      {mine.length === 0 ? (
        <Card>
          <EmptyState text={t("none")} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="reports">
          {mine.map((r) => {
            const tooLong = days < 0 || days > r.maxDays;
            return (
              <Card key={r.kind} className="flex flex-col gap-3 p-5" data-report={r.kind}>
                <div className="flex items-start gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
                    aria-hidden
                  >
                    {r.icon}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-foreground">{t(`kinds.${r.kind}.title`)}</h2>
                    <p className="text-sm text-muted">{t(`kinds.${r.kind}.text`)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted">
                  {r.byClass ? t("maxDaysClass", { n: r.maxDays }) : t("maxDays", { n: r.maxDays })}
                </p>
                {tooLong && <p className="text-sm text-danger">{t("rangeTooLong", { n: r.maxDays })}</p>}
                <div>
                  <Button
                    variant="secondary"
                    disabled={tooLong}
                    loading={busy === r.kind}
                    onClick={() => void download(r)}
                  >
                    <Download className="size-4" aria-hidden />
                    {t("download")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
