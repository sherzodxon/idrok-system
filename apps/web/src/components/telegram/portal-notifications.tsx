"use client";

// The guardian's own notification settings and Telegram link (portal profile and Mini App), M7 T-95.
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MyNotificationsDto, NotificationPreferenceDto } from "@idrok/shared";
import { Check, fromHhMm, toHhMm } from "@/components/attendance/common";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/modal";
import { QueryBoundary } from "@/components/ui/states";
import { useSave } from "@/lib/use-save";
import { LinkStatusBadge } from "./admin";

export function PortalNotificationsCard() {
  const api = useApi();
  const query = useQuery({
    queryKey: ["my-notifications"],
    queryFn: () => api.get<MyNotificationsDto>("/portal/notifications"),
  });
  return (
    <QueryBoundary query={query}>{(d) => <NotificationsForm key={JSON.stringify(d)} initial={d} />}</QueryBoundary>
  );
}

const KINDS = ["arrival", "departure", "dailyDigest", "testResults", "lowAttendance"] as const;

function NotificationsForm({ initial }: { initial: MyNotificationsDto }) {
  const t = useTranslations("telegram.portal");
  const api = useApi();
  const p = initial.preferences;
  const [d, setD] = useState({
    ...p,
    own: p.quietStartMinute !== null,
    start: toHhMm(p.quietStartMinute ?? initial.schoolQuietStartMinute),
    end: toHhMm(p.quietEndMinute ?? initial.schoolQuietEndMinute),
  });
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const save = useSave(() => {
    const body: Partial<NotificationPreferenceDto> = {
      arrival: d.arrival,
      departure: d.departure,
      dailyDigest: d.dailyDigest,
      testResults: d.testResults,
      lowAttendance: d.lowAttendance,
      quietHoursOff: d.quietHoursOff,
      quietStartMinute: d.own ? fromHhMm(d.start) : null,
      quietEndMinute: d.own ? fromHhMm(d.end) : null,
    };
    return api.put("/portal/notifications", body);
  }, ["my-notifications"]);
  const unlink = useSave(
    () => api.delete("/portal/telegram"),
    ["my-notifications"],
    () => setConfirmUnlink(false),
  );
  const bot = initial.telegram.botUsername;

  return (
    <Card data-testid="portal-notifications">
      <CardHeader title={t("title")} />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("telegram")}</span>
          <LinkStatusBadge status={initial.telegram.status} />
          {initial.telegram.status === "NOT_LINKED" && bot && (
            <a className="text-primary underline" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">
              {t("openBot", { bot })}
            </a>
          )}
          {initial.telegram.status !== "NOT_LINKED" && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(true)}>
              {t("unlink")}
            </Button>
          )}
        </div>
        {initial.telegram.status === "NOT_LINKED" && <p className="text-sm text-muted">{t("linkHint")}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <Check key={k} label={t(`kinds.${k}`)} checked={d[k]} onChange={(v) => set({ [k]: v })} />
          ))}
        </div>
        <Check label={t("quietOff")} checked={d.quietHoursOff} onChange={(v) => set({ quietHoursOff: v })} />
        {!d.quietHoursOff && (
          <>
            <Check label={t("ownQuiet")} checked={d.own} onChange={(v) => set({ own: v })} />
            {d.own ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("quietStart")}>
                  {(id) => (
                    <Input
                      id={id}
                      type="time"
                      required
                      value={d.start}
                      onChange={(e) => set({ start: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t("quietEnd")}>
                  {(id) => (
                    <Input id={id} type="time" required value={d.end} onChange={(e) => set({ end: e.target.value })} />
                  )}
                </Field>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {t("schoolQuiet", {
                  from: toHhMm(initial.schoolQuietStartMinute),
                  to: toHhMm(initial.schoolQuietEndMinute),
                })}
              </p>
            )}
          </>
        )}
        <div>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {t("save")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmUnlink}
        danger
        title={t("unlinkTitle")}
        text={t("unlinkText")}
        loading={unlink.isPending}
        onConfirm={() => unlink.mutate(undefined)}
        onCancel={() => setConfirmUnlink(false)}
      />
    </Card>
  );
}
