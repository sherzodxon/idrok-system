"use client";

// Attendance settings and lateness bands (MASTER_SPEC §11 "Kechikish"): a band in use keeps its range and is archived
// instead of deleted (the API enforces both).
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { AttendanceSettingsDto, LatenessBandDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useSave } from "@/lib/use-save";
import { Check, fromHhMm, toHhMm } from "./common";

export function AttendanceSettingsTab() {
  const api = useApi();
  const settings = useQuery({
    queryKey: ["attendance-settings"],
    queryFn: () => api.get<AttendanceSettingsDto>("/attendance/settings"),
  });
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={settings}>{(s) => <SettingsForm key={JSON.stringify(s)} initial={s} />}</QueryBoundary>
      <Bands />
    </div>
  );
}

function SettingsForm({ initial }: { initial: AttendanceSettingsDto }) {
  const t = useTranslations("attendance");
  const api = useApi();
  const [d, setD] = useState({
    isEnabled: initial.isEnabled,
    start: toHhMm(initial.defaultStartMinute),
    end: toHhMm(initial.defaultEndMinute),
    graceMinutes: String(initial.graceMinutes),
    acceptedSubEvents: initial.acceptedSubEvents.join(", "),
    maxClockSkewSeconds: String(initial.maxClockSkewSeconds),
    maxEventAgeDays: String(initial.maxEventAgeDays),
    deviceStaleSeconds: String(initial.deviceStaleSeconds),
    faceConsentRequired: initial.faceConsentRequired,
    staffStart: toHhMm(initial.staffStartMinute),
    staffEnd: toHhMm(initial.staffEndMinute),
    staffGraceMinutes: String(initial.staffGraceMinutes),
  });
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const save = useSave(
    () =>
      api.put("/attendance/settings", {
        isEnabled: d.isEnabled,
        defaultStartMinute: fromHhMm(d.start),
        defaultEndMinute: fromHhMm(d.end),
        graceMinutes: Number(d.graceMinutes),
        acceptedSubEvents: d.acceptedSubEvents
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
        maxClockSkewSeconds: Number(d.maxClockSkewSeconds),
        maxEventAgeDays: Number(d.maxEventAgeDays),
        deviceStaleSeconds: Number(d.deviceStaleSeconds),
        faceConsentRequired: d.faceConsentRequired,
        staffStartMinute: fromHhMm(d.staffStart),
        staffEndMinute: fromHhMm(d.staffEnd),
        staffGraceMinutes: Number(d.staffGraceMinutes),
      }),
    ["attendance-settings", "attendance-status"],
  );
  const num = (key: keyof typeof d, min: number, max: number) => (id: string) => (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      required
      value={d[key] as string}
      onChange={(e) => set({ [key]: e.target.value })}
    />
  );
  return (
    <Card>
      <CardHeader title={t("settings.title")} />
      <form
        className="flex flex-col gap-4 px-5 pb-5"
        data-testid="attendance-settings"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        {!initial.encryptionConfigured && (
          <p className="rounded-button bg-warning-soft px-3 py-2 text-sm">{t("settings.noEncryption")}</p>
        )}
        <Check label={t("settings.isEnabled")} checked={d.isEnabled} onChange={(v) => set({ isEnabled: v })} />
        <Check
          label={t("settings.faceConsentRequired")}
          checked={d.faceConsentRequired}
          onChange={(v) => set({ faceConsentRequired: v })}
        />
        <p className="text-sm text-muted">{t("settings.shiftHint")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("settings.start")}>
            {(id) => (
              <Input id={id} type="time" required value={d.start} onChange={(e) => set({ start: e.target.value })} />
            )}
          </Field>
          <Field label={t("settings.end")}>
            {(id) => (
              <Input id={id} type="time" required value={d.end} onChange={(e) => set({ end: e.target.value })} />
            )}
          </Field>
          <Field label={t("settings.grace")} hint={t("settings.graceHint")}>
            {num("graceMinutes", 0, 120)}
          </Field>
        </div>
        <p className="text-sm text-muted">{t("settings.staffHint")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("settings.staffStart")}>
            {(id) => (
              <Input
                id={id}
                type="time"
                required
                value={d.staffStart}
                onChange={(e) => set({ staffStart: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("settings.staffEnd")}>
            {(id) => (
              <Input
                id={id}
                type="time"
                required
                value={d.staffEnd}
                onChange={(e) => set({ staffEnd: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("settings.grace")} hint={t("settings.graceHint")}>
            {num("staffGraceMinutes", 0, 120)}
          </Field>
        </div>
        <details className="rounded-card border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">{t("settings.advanced")}</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("settings.subEvents")} hint={t("settings.subEventsHint")}>
              {(id) => (
                <Input
                  id={id}
                  required
                  value={d.acceptedSubEvents}
                  onChange={(e) => set({ acceptedSubEvents: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("settings.skew")} hint={t("settings.skewHint")}>
              {num("maxClockSkewSeconds", 0, 3600)}
            </Field>
            <Field label={t("settings.age")} hint={t("settings.ageHint")}>
              {num("maxEventAgeDays", 1, 60)}
            </Field>
            <Field label={t("settings.stale")} hint={t("settings.staleHint")}>
              {num("deviceStaleSeconds", 30, 86400)}
            </Field>
          </div>
        </details>
        <div>
          <Button type="submit" loading={save.isPending}>
            {t("settings.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Bands() {
  const t = useTranslations("attendance");
  const api = useApi();
  const bands = useQuery({
    queryKey: ["lateness-bands"],
    queryFn: () => api.get<LatenessBandDto[]>("/attendance/lateness-bands"),
  });
  const [editing, setEditing] = useState<LatenessBandDto | "new" | null>(null);
  const remove = useSave((b: LatenessBandDto) => api.delete(`/attendance/lateness-bands/${b.id}`), ["lateness-bands"]);
  return (
    <Card>
      <CardHeader
        title={t("bands.title")}
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            {t("bands.add")}
          </Button>
        }
      />
      <p className="px-5 pb-3 text-sm text-muted">{t("bands.help")}</p>
      <QueryBoundary query={bands} isEmpty={(l) => l.length === 0} empty={<EmptyState text={t("bands.empty")} />}>
        {(list) => (
          <DataTable
            testId="lateness-bands"
            rows={list}
            columns={[
              {
                key: "name",
                header: t("bands.name"),
                primary: true,
                cell: (b) => <span className={b.archived ? "text-muted line-through" : "font-medium"}>{b.name}</span>,
              },
              {
                key: "range",
                header: t("bands.range"),
                cell: (b) =>
                  b.toMinute === null
                    ? t("bands.fromOnly", { from: b.fromMinute })
                    : t("bands.fromTo", { from: b.fromMinute, to: b.toMinute }),
              },
              {
                key: "actions",
                header: "",
                cell: (b) =>
                  b.archived ? (
                    <span className="text-xs text-muted">{t("bands.archived")}</span>
                  ) : (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={t("bands.edit")} onClick={() => setEditing(b)}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={t("bands.remove")} onClick={() => remove.mutate(b)}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </span>
                  ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && <BandDrawer band={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function BandDrawer({ band, onClose }: { band: LatenessBandDto | null; onClose: () => void }) {
  const t = useTranslations("attendance");
  const api = useApi();
  const [name, setName] = useState(band?.name ?? "");
  const [from, setFrom] = useState(String(band?.fromMinute ?? 1));
  const [to, setTo] = useState(band?.toMinute === null ? "" : String(band?.toMinute ?? 3));
  const save = useSave(
    () => {
      const body = { name, fromMinute: Number(from), toMinute: to === "" ? null : Number(to) };
      return band
        ? api.put(`/attendance/lateness-bands/${band.id}`, body)
        : api.post("/attendance/lateness-bands", body);
    },
    ["lateness-bands"],
    onClose,
  );
  return (
    <FormDrawer title={band ? t("bands.edit") : t("bands.add")} formId="band" busy={save.isPending} onClose={onClose}>
      <form
        id="band"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("bands.name")}>
          {(id) => <Input id={id} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("bands.from")}>
            {(id) => (
              <Input id={id} type="number" min={1} required value={from} onChange={(e) => setFrom(e.target.value)} />
            )}
          </Field>
          <Field label={t("bands.to")} hint={t("bands.toHint")}>
            {(id) => <Input id={id} type="number" min={2} value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
        </div>
      </form>
    </FormDrawer>
  );
}
