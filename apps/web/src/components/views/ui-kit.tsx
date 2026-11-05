"use client";

// Design-system reference page (dev only): every new primitive with sample data and its states.
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { AttendanceHeatmap, BarList, LimitMeter, TrendChart, type DayMark } from "@/components/ui/charts";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { KpiHeroCard, StatCard } from "@/components/ui/stats";
import { PageHeader } from "@/components/ui/toolbar";
import { formatDate } from "@/lib/format";

const TREND = [93.1, 94.0, 92.4, 95.2, 94.8, 91.9, null, 93.6, 94.4, 95.0, 93.2, 92.8, 94.9, 95.3];
const MARKS = "pppppppplpppappoppppppppppplppppeppppoppppppppplpppapppppppp";
const MARK_OF: Record<string, DayMark> = { p: "present", l: "late", a: "absent", e: "excused", o: "off" };
const DAYS = [...MARKS].map((c, i) => ({
  date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
  mark: MARK_OF[c] ?? null,
}));
const pct = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;

export function UiKit() {
  const t = useTranslations("uiKit");
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiHeroCard label={t("present")} value="94,2%" hint={t("presentHint")} />
        <StatCard label={t("late")} value={11} delta={{ text: t("lateDelta"), tone: "bad" }} />
        <StatCard label={t("average")} value="78,4" delta={{ text: t("averageDelta"), tone: "good" }} />
        <StatCard label={t("students")} value={412} icon={<Users className="size-5" aria-hidden />} loading />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("trendTitle")} />
          <div className="p-5 pt-3">
            <TrendChart
              label={t("trendTitle")}
              points={TREND.map((value, i) => ({ value, label: i % 3 === 0 ? String(22 + i) : "" }))}
              floor={88}
              ceil={98}
              format={pct}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("byClass")} />
          <div className="p-5 pt-3">
            <BarList
              max={100}
              format={(v) => `${v}%`}
              items={[
                { key: "5a", label: "5-A", value: 97 },
                { key: "6b", label: "6-B", value: 96 },
                { key: "7a", label: "7-A", value: 91 },
                { key: "8a", label: "8-A", value: 94 },
                { key: "9b", label: "9-B", value: 88 },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("heatmap")} />
          <div className="p-5 pt-3">
            <AttendanceHeatmap days={DAYS} formatDate={formatDate} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("limits")} />
          <ul className="flex flex-col gap-3 p-5 pt-3 text-sm">
            {[4, 8, 10].map((used) => (
              <li key={used} className="flex items-center justify-between gap-3">
                <span className="tabular text-muted">{t("limitRow", { used, limit: 10 })}</span>
                <LimitMeter used={used} limit={10} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            <Badge tone="success">{t("present")}</Badge>
            <Badge tone="warning">{t("late")}</Badge>
            <Badge tone="danger">{t("absent")}</Badge>
            <Badge tone="primary">{t("now")}</Badge>
            <Badge>{t("later")}</Badge>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <LoadingState rows={4} />
        </Card>
        <Card>
          <EmptyState title={t("emptyTitle")} text={t("emptyText")} />
        </Card>
        <Card>
          <ErrorState error={new Error("demo")} onRetry={() => undefined} />
        </Card>
      </div>

      <div>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          {t("openConfirm")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title={t("confirmTitle")}
        text={t("confirmText")}
        onConfirm={() => setConfirm(false)}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
