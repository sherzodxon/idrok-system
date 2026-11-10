"use client";

// M7 admin: guardians' Telegram link status (codes, unlink), broadcasts to classes, notification settings.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type {
  BroadcastDto,
  BroadcastPreviewDto,
  LinkCodeIssuedDto,
  Page,
  TelegramAdminSettingsDto,
  TelegramGuardianDto,
  TelegramLinkStatus,
} from "@idrok/shared";
import { Check, formatDateTime, fromHhMm, toHhMm } from "@/components/attendance/common";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/field";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stats";
import { useToast } from "@/components/ui/toast";
import { FilterSelect, PageHeader, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useClassGroups } from "@/lib/queries";
import { useErrorText } from "@/lib/use-error-text";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";

type Tab = "guardians" | "broadcast" | "settings";

export function AdminTelegramPage() {
  const t = useTranslations("telegram");
  const me = useMe();
  const tabs = (
    [
      ["guardians", "telegram.manage"],
      ["broadcast", "notifications.broadcast"],
      ["settings", "telegram.manage"],
    ] as const
  )
    .filter(([, p]) => can(me.data, p))
    .map(([value]) => ({ value: value as Tab, label: t(`tabs.${value}`) }));
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? "guardians");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "guardians" && <GuardiansTab />}
      {tab === "broadcast" && <BroadcastTab />}
      {tab === "settings" && <SettingsTab />}
    </>
  );
}

const STATUS_TONE: Record<TelegramLinkStatus, "success" | "warning" | "neutral"> = {
  LINKED: "success",
  BLOCKED: "warning",
  NOT_LINKED: "neutral",
};

export function LinkStatusBadge({ status }: { status: TelegramLinkStatus }) {
  const t = useTranslations("telegram");
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

function Summary() {
  const t = useTranslations("telegram");
  const api = useApi();
  const summary = useQuery({
    queryKey: ["telegram-summary"],
    queryFn: () => api.get<{ guardians: number; linked: number; blocked: number }>("/telegram/summary"),
  });
  if (!summary.data) return null;
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="telegram-summary">
      <StatCard label={t("summary.guardians")} value={summary.data.guardians} />
      <StatCard label={t("summary.linked")} value={summary.data.linked} />
      <StatCard label={t("summary.blocked")} value={summary.data.blocked} />
    </div>
  );
}

function GuardiansTab() {
  const t = useTranslations("telegram");
  const locale = useLocale();
  const api = useApi();
  const toast = useToast();
  const errorText = useErrorText();
  const list = useListState(["status", "classGroupId"] as const);
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const query = useQuery({
    queryKey: ["telegram-guardians", list.apiQuery],
    queryFn: () => api.get<Page<TelegramGuardianDto>>(`/telegram/guardians?${list.apiQuery}`),
  });
  const [issued, setIssued] = useState<{ name: string; code: LinkCodeIssuedDto } | null>(null);
  const [unlinking, setUnlinking] = useState<TelegramGuardianDto | null>(null);
  const issue = useMutation({
    mutationFn: (g: TelegramGuardianDto) =>
      api
        .post<LinkCodeIssuedDto>(`/telegram/guardians/${g.guardianId}/link-code`)
        .then((code) => ({ name: g.fullName, code })),
    onSuccess: (r) => {
      setIssued(r);
      void query.refetch();
    },
    onError: (err) => toast("error", errorText(err)),
  });
  const unlink = useSave(
    (g: TelegramGuardianDto) => api.delete(`/telegram/guardians/${g.guardianId}/link`),
    ["telegram-guardians", "telegram-summary"],
    () => setUnlinking(null),
  );

  return (
    <>
      <Summary />
      <Card>
        <Toolbar>
          <SearchInput value={list.q} onChange={(q) => list.update({ q })} label={t("guardians.search")} />
          <FilterSelect
            label={t("guardians.status")}
            value={list.filters.status}
            onChange={(status) => list.update({ status })}
            allLabel={t("guardians.allStatuses")}
            options={(["LINKED", "BLOCKED", "NOT_LINKED"] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}
          />
          <FilterSelect
            label={t("guardians.class")}
            value={list.filters.classGroupId}
            onChange={(classGroupId) => list.update({ classGroupId })}
            allLabel={t("guardians.allClasses")}
            options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Toolbar>
        <QueryBoundary query={query}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title={t("guardians.empty")} />
            ) : (
              <>
                <DataTable
                  testId="telegram-guardians"
                  rows={data.items.map((g) => ({ ...g, id: g.guardianId }))}
                  columns={[
                    {
                      key: "name",
                      header: t("guardians.guardian"),
                      primary: true,
                      cell: (g) => (
                        <span className="flex flex-col">
                          <span className="font-medium">{g.fullName}</span>
                          <span className="text-xs text-muted tabular">{g.phone}</span>
                        </span>
                      ),
                    },
                    {
                      key: "children",
                      header: t("guardians.children"),
                      cell: (g) =>
                        g.children
                          .map((c) => (c.classGroup ? `${c.fullName} (${c.classGroup})` : c.fullName))
                          .join(", "),
                    },
                    {
                      key: "status",
                      header: t("guardians.status"),
                      cell: (g) => (
                        <span className="flex flex-col gap-1">
                          <LinkStatusBadge status={g.status} />
                          {g.linkedAt && (
                            <span className="text-xs text-muted">
                              {t(`method.${g.method ?? "CODE"}`)} · {formatDateTime(g.linkedAt, locale)}
                            </span>
                          )}
                          {g.status === "NOT_LINKED" && g.pendingCodeExpiresAt && (
                            <span className="text-xs text-muted">
                              {t("guardians.codeUntil", { at: formatDateTime(g.pendingCodeExpiresAt, locale) })}
                            </span>
                          )}
                        </span>
                      ),
                    },
                    {
                      key: "lastSent",
                      header: t("guardians.lastSent"),
                      cell: (g) => formatDateTime(g.lastSentAt, locale),
                    },
                    {
                      key: "actions",
                      header: "",
                      className: "text-right",
                      cell: (g) => (
                        <span className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="whitespace-nowrap"
                            loading={issue.isPending && issue.variables?.guardianId === g.guardianId}
                            onClick={() => issue.mutate(g)}
                          >
                            {t("guardians.issueCode")}
                          </Button>
                          {g.status !== "NOT_LINKED" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="whitespace-nowrap"
                              onClick={() => setUnlinking(g)}
                            >
                              {t("guardians.unlink")}
                            </Button>
                          )}
                        </span>
                      ),
                    },
                  ]}
                />
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  onPage={(page) => list.update({ page })}
                />
              </>
            )
          }
        </QueryBoundary>
      </Card>
      <Modal open={!!issued} onClose={() => setIssued(null)} title={t("code.title")}>
        {issued && (
          <div className="flex flex-col gap-3 text-sm" data-testid="link-code">
            <p>{t("code.for", { name: issued.name })}</p>
            <p
              className="rounded-button bg-surface-muted px-3 py-2 text-center font-mono text-2xl tracking-widest"
              data-testid="link-code-value"
            >
              {issued.code.code}
            </p>
            {issued.code.deepLink ? (
              <p className="break-all">
                {t("code.link")}{" "}
                <a className="text-primary underline" href={issued.code.deepLink} target="_blank" rel="noreferrer">
                  {issued.code.deepLink}
                </a>
              </p>
            ) : (
              <p className="text-muted">{t("code.noBotUsername")}</p>
            )}
            <p className="text-muted">{t("code.expires", { at: formatDateTime(issued.code.expiresAt, locale) })}</p>
            <p className="text-warning">{t("code.once")}</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!unlinking}
        danger
        title={t("guardians.unlinkTitle")}
        text={t("guardians.unlinkText", { name: unlinking?.fullName ?? "" })}
        loading={unlink.isPending}
        onConfirm={() => unlinking && unlink.mutate(unlinking)}
        onCancel={() => setUnlinking(null)}
      />
    </>
  );
}

function BroadcastTab() {
  const t = useTranslations("telegram");
  const locale = useLocale();
  const api = useApi();
  const toast = useToast();
  const errorText = useErrorText();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<BroadcastPreviewDto | null>(null);
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ["telegram-broadcasts", page],
    queryFn: () => api.get<Page<BroadcastDto>>(`/telegram/broadcasts?page=${page}&pageSize=10`),
  });
  const check = useMutation({
    mutationFn: () => api.post<BroadcastPreviewDto>("/telegram/broadcasts/preview", { classGroupIds: selected }),
    onSuccess: setPreview,
    onError: (err) => toast("error", errorText(err)),
  });
  const send = useSave(
    () => api.post("/telegram/broadcasts", { classGroupIds: selected, text }),
    ["telegram-broadcasts"],
    () => {
      setPreview(null);
      setText("");
      setSelected([]);
    },
  );
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t("broadcast.new")} />
        <form
          className="flex flex-col gap-4 px-5 pb-5"
          data-testid="broadcast-form"
          onSubmit={(e: FormEvent) => (e.preventDefault(), check.mutate())}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("broadcast.classes")}</legend>
            {classes.data?.length === 0 && <p className="text-sm text-muted">{t("broadcast.noClasses")}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {classes.data?.map((c) => (
                <Check key={c.id} label={c.name} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
              ))}
            </div>
            {!!classes.data?.length && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected(selected.length === classes.data.length ? [] : classes.data.map((c) => c.id))
                  }
                >
                  {selected.length === classes.data.length ? t("broadcast.none") : t("broadcast.all")}
                </Button>
              </div>
            )}
          </fieldset>
          <Field label={t("broadcast.text")} hint={t("broadcast.textHint", { n: text.length, max: 3000 })}>
            {(id) => (
              <textarea
                id={id}
                required
                maxLength={3000}
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full rounded-button border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            )}
          </Field>
          <div>
            <Button type="submit" disabled={!selected.length || !text.trim()} loading={check.isPending}>
              {t("broadcast.preview")}
            </Button>
          </div>
        </form>
      </Card>
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={t("broadcast.confirmTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              {t("broadcast.back")}
            </Button>
            <Button loading={send.isPending} disabled={!preview?.guardians} onClick={() => send.mutate(undefined)}>
              {t("broadcast.send")}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-3 text-sm" data-testid="broadcast-preview">
            <p>{t("broadcast.counts", { ...preview })}</p>
            {preview.reachable < preview.guardians && <p className="text-warning">{t("broadcast.unreachable")}</p>}
            <p className="whitespace-pre-wrap rounded-button bg-surface-muted px-3 py-2">{text}</p>
          </div>
        )}
      </Modal>
      <Card>
        <CardHeader title={t("broadcast.history")} />
        <QueryBoundary query={history}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title={t("broadcast.empty")} />
            ) : (
              <>
                <DataTable
                  testId="broadcast-history"
                  rows={data.items}
                  columns={[
                    {
                      key: "text",
                      header: t("broadcast.text"),
                      primary: true,
                      cell: (b) => <span className="line-clamp-2">{b.text}</span>,
                    },
                    { key: "classes", header: t("broadcast.classes"), cell: (b) => b.classGroups.join(", ") },
                    {
                      key: "delivery",
                      header: t("broadcast.delivery"),
                      cell: (b) =>
                        t("broadcast.deliveryCounts", {
                          sent: b.sent,
                          pending: b.pending,
                          failed: b.failed,
                          skipped: b.skipped,
                        }),
                    },
                    {
                      key: "when",
                      header: t("broadcast.when"),
                      cell: (b) => `${formatDateTime(b.createdAt, locale)}${b.createdBy ? ` · ${b.createdBy}` : ""}`,
                    },
                  ]}
                />
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )
          }
        </QueryBoundary>
      </Card>
    </div>
  );
}

function SettingsTab() {
  const api = useApi();
  const query = useQuery({
    queryKey: ["telegram-settings"],
    queryFn: () => api.get<TelegramAdminSettingsDto>("/telegram/settings"),
  });
  return <QueryBoundary query={query}>{(s) => <SettingsForm key={JSON.stringify(s)} initial={s} />}</QueryBoundary>;
}

function SettingsForm({ initial }: { initial: TelegramAdminSettingsDto }) {
  const t = useTranslations("telegram");
  const api = useApi();
  const s = initial.settings;
  const [d, setD] = useState({
    ...s,
    quietStart: toHhMm(s.quietStartMinute),
    quietEnd: toHhMm(s.quietEndMinute),
    digest: toHhMm(s.digestMinute),
  });
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const save = useSave(
    () =>
      api.put("/telegram/settings", {
        isEnabled: d.isEnabled,
        arrivalEnabled: d.arrivalEnabled,
        departureEnabled: d.departureEnabled,
        lowAttendanceEnabled: d.lowAttendanceEnabled,
        dailyDigestEnabled: d.dailyDigestEnabled,
        testResultsEnabled: d.testResultsEnabled,
        smsFallbackEnabled: d.smsFallbackEnabled,
        departureDelayMinutes: Number(d.departureDelayMinutes),
        digestMinute: fromHhMm(d.digest),
        lowAttendanceThreshold: String(d.lowAttendanceThreshold),
        lowAttendanceWindowDays: Number(d.lowAttendanceWindowDays),
        quietStartMinute: fromHhMm(d.quietStart),
        quietEndMinute: fromHhMm(d.quietEnd),
        maxPerGuardianPerHour: Number(d.maxPerGuardianPerHour),
        linkCodeTtlHours: Number(d.linkCodeTtlHours),
      }),
    ["telegram-settings"],
  );
  const num =
    (key: keyof typeof d, min: number, max: number, step = 1) =>
    (id: string) => (
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        required
        value={String(d[key])}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    );
  const time = (key: "quietStart" | "quietEnd" | "digest") => (id: string) => (
    <Input id={id} type="time" required value={d[key]} onChange={(e) => set({ [key]: e.target.value })} />
  );
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2 p-5 text-sm" data-testid="telegram-status">
        <p>
          {t("settings.bot")}{" "}
          <Badge tone={initial.status.botConfigured ? "success" : "warning"}>
            {initial.status.botConfigured ? t("settings.botOn") : t("settings.botOff")}
          </Badge>
          {initial.status.botUsername && <span className="ml-2 text-muted">@{initial.status.botUsername}</span>}
        </p>
        {!initial.status.botConfigured && <p className="text-muted">{t("settings.botOffHint")}</p>}
      </Card>
      <Card>
        <CardHeader title={t("settings.title")} />
        <form
          className="flex flex-col gap-4 px-5 pb-5"
          data-testid="telegram-settings"
          onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
        >
          <Check label={t("settings.isEnabled")} checked={d.isEnabled} onChange={(v) => set({ isEnabled: v })} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                "arrivalEnabled",
                "departureEnabled",
                "dailyDigestEnabled",
                "testResultsEnabled",
                "lowAttendanceEnabled",
              ] as const
            ).map((k) => (
              <Check key={k} label={t(`settings.${k}`)} checked={d[k]} onChange={(v) => set({ [k]: v })} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t("settings.quietStart")}>{time("quietStart")}</Field>
            <Field label={t("settings.quietEnd")} hint={t("settings.quietHint")}>
              {time("quietEnd")}
            </Field>
            <Field label={t("settings.digest")}>{time("digest")}</Field>
            <Field label={t("settings.departureDelay")}>{num("departureDelayMinutes", 0, 180)}</Field>
            <Field label={t("settings.lowThreshold")}>{num("lowAttendanceThreshold", 0, 100, 0.01)}</Field>
            <Field label={t("settings.lowWindow")}>{num("lowAttendanceWindowDays", 7, 120)}</Field>
            <Field label={t("settings.perHour")}>{num("maxPerGuardianPerHour", 1, 100)}</Field>
            <Field label={t("settings.codeTtl")}>{num("linkCodeTtlHours", 1, 720)}</Field>
          </div>
          <Check
            label={t("settings.smsFallback")}
            checked={d.smsFallbackEnabled}
            onChange={(v) => set({ smsFallbackEnabled: v })}
          />
          {!initial.status.smsProviderConfigured && <p className="text-sm text-muted">{t("settings.noSmsProvider")}</p>}
          <div>
            <Button type="submit" loading={save.isPending}>
              {t("settings.save")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
