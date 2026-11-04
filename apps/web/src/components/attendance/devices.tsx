"use client";

// Terminals and bridges (MASTER_SPEC §11 "Qurilmalar", "Bridge", monitoring): health at a glance, terminals with their
// connection and face sync counts, bridges with their queue, the raw events of a day. Keys and tokens are shown once.
import { useQuery } from "@tanstack/react-query";
import { Archive, Copy, History, KeyRound, Pencil, Plus, RefreshCw, ScanFace, Server } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { AccessEventDto, AttendanceMonitoringDto, BridgeAgentDto, DeviceDto, Page } from "@idrok/shared";
import { addSchoolDays, schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stats";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { Toolbar } from "@/components/ui/toolbar";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { Check, ConnectionBadge, formatDateTime, formatTime } from "./common";

const KEYS = ["devices", "bridge-agents", "attendance-monitoring"];

/** A secret shown once (device webhook key, bridge token). */
function SecretOnce({
  title,
  lines,
  onClose,
}: {
  title: string;
  lines: { label: string; value: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("attendance");
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={title} footer={<Button onClick={onClose}>{t("devices.done")}</Button>}>
      <div className="flex flex-col gap-3" data-testid="secret-once">
        <p className="rounded-button bg-warning-soft px-3 py-2 text-sm text-foreground">{t("devices.shownOnce")}</p>
        {lines.map((l) => (
          <div key={l.label} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{l.label}</span>
            <span className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-button bg-surface-muted px-2 py-1 text-xs">
                {l.value}
              </code>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("devices.copy")}
                onClick={() => void navigator.clipboard?.writeText(l.value).then(() => setCopied(l.label))}
              >
                <Copy className="size-4" aria-hidden />
                {copied === l.label ? t("devices.copied") : null}
              </Button>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function Monitoring() {
  const t = useTranslations("attendance");
  const api = useApi();
  const m = useQuery({
    queryKey: ["attendance-monitoring"],
    queryFn: () => api.get<AttendanceMonitoringDto>("/attendance/monitoring"),
    refetchInterval: 30_000,
  });
  return (
    <QueryBoundary query={m}>
      {(x) => (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="attendance-monitoring">
          <StatCard
            label={t("monitoring.devices")}
            value={`${x.devices.online} / ${x.devices.online + x.devices.offline + x.devices.unknown}`}
            hint={
              x.devices.offline
                ? t("monitoring.offline", { n: x.devices.offline })
                : x.devices.online
                  ? t("monitoring.allOnline")
                  : undefined
            }
          />
          <StatCard
            label={t("monitoring.bridges")}
            value={`${x.bridges.online} / ${x.bridges.online + x.bridges.offline + x.bridges.unknown}`}
            hint={x.bridges.offline ? t("monitoring.offline", { n: x.bridges.offline }) : undefined}
          />
          <StatCard
            label={t("monitoring.events")}
            value={String(x.eventsToday)}
            hint={x.unmatchedToday ? t("monitoring.unmatched", { n: x.unmatchedToday }) : undefined}
          />
          <StatCard
            label={t("monitoring.faces")}
            value={String(x.faces.synced)}
            hint={t("monitoring.facesHint", { pending: x.faces.pending, failed: x.faces.failed, none: x.faces.none })}
          />
        </div>
      )}
    </QueryBoundary>
  );
}

export function DevicesTab() {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const api = useApi();
  const me = useMe();
  const canFaces = can(me.data, "face.manage");
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.get<DeviceDto[]>("/devices"),
    refetchInterval: 30_000,
  });
  const [editing, setEditing] = useState<DeviceDto | "new" | null>(null);
  const [secret, setSecret] = useState<{ title: string; lines: { label: string; value: string }[] } | null>(null);
  const [history, setHistory] = useState<DeviceDto | null>(null);
  const [archiving, setArchiving] = useState<DeviceDto | null>(null);
  const keyLines = (r: { device: DeviceDto; webhookKey: string; webhookPath: string }) => [
    { label: t("devices.webhookUrl"), value: r.webhookPath },
    { label: t("devices.bridgePath"), value: `/hik/${r.device.id}` },
  ];
  const rotate = useSave(async (d: DeviceDto) => {
    const r = await api.post<{ device: DeviceDto; webhookKey: string; webhookPath: string }>(
      `/devices/${d.id}/rotate-key`,
    );
    setSecret({ title: t("devices.newKey"), lines: keyLines(r) });
  }, KEYS);
  const check = useSave((d: DeviceDto) => api.post(`/devices/${d.id}/check`), KEYS);
  const syncFaces = useSave((d: DeviceDto) => api.post(`/devices/${d.id}/sync-faces`), [...KEYS, "face-profiles"]);
  const archive = useSave(
    (d: DeviceDto) => api.post(`/devices/${d.id}/archive`),
    KEYS,
    () => setArchiving(null),
  );
  return (
    <>
      <Monitoring />
      <Card className="mb-4">
        <CardHeader
          title={t("devices.title")}
          action={
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden />
              {t("devices.add")}
            </Button>
          }
        />
        <QueryBoundary query={devices} isEmpty={(l) => l.length === 0} empty={<EmptyState text={t("devices.empty")} />}>
          {(list) => (
            <DataTable
              testId="devices"
              rows={list}
              columns={[
                {
                  key: "name",
                  header: t("devices.name"),
                  primary: true,
                  cell: (d) => (
                    <span className={d.archived ? "text-muted line-through" : ""}>
                      <span className="font-medium">{d.name}</span>
                      <span className="ml-2 text-xs text-muted">
                        {t(`direction.${d.direction}`)}
                        {d.location ? ` · ${d.location}` : ""}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "connection",
                  header: t("devices.connection"),
                  cell: (d) => (
                    <span className="flex flex-col gap-0.5">
                      <ConnectionBadge value={d.connection} />
                      <span className="text-xs text-muted">
                        {d.useBridge ? t("devices.viaBridge", { name: d.bridgeAgentName ?? "—" }) : t("devices.direct")}
                      </span>
                      {d.lastError && <span className="text-xs text-danger">{d.lastError}</span>}
                    </span>
                  ),
                },
                {
                  key: "events",
                  header: t("devices.eventsToday"),
                  cell: (d) => (
                    <span className="text-sm">
                      {d.eventsToday}
                      <span className="block text-xs text-muted">{formatDateTime(d.lastEventAt, locale)}</span>
                    </span>
                  ),
                },
                {
                  key: "faces",
                  header: t("devices.faces"),
                  cell: (d) => (
                    <span className="flex flex-wrap gap-1">
                      <Badge tone="success">{d.faces.synced}</Badge>
                      {d.faces.pending > 0 && <Badge tone="warning">{d.faces.pending}</Badge>}
                      {d.faces.failed > 0 && <Badge tone="danger">{d.faces.failed}</Badge>}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  cell: (d) =>
                    d.archived ? null : (
                      <span className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" aria-label={t("devices.edit")} onClick={() => setEditing(d)}>
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("devices.check")}
                          onClick={() => check.mutate(d)}
                        >
                          <RefreshCw className="size-4" aria-hidden />
                        </Button>
                        {canFaces && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("devices.syncFaces")}
                            onClick={() => syncFaces.mutate(d)}
                          >
                            <ScanFace className="size-4" aria-hidden />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("devices.history")}
                          onClick={() => setHistory(d)}
                        >
                          <History className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("devices.rotateKey")}
                          onClick={() => rotate.mutate(d)}
                        >
                          <KeyRound className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("devices.archive")}
                          onClick={() => setArchiving(d)}
                        >
                          <Archive className="size-4" aria-hidden />
                        </Button>
                      </span>
                    ),
                },
              ]}
            />
          )}
        </QueryBoundary>
      </Card>
      <Bridges onSecret={setSecret} />
      <Events />
      {editing && (
        <DeviceDrawer
          device={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(r) => setSecret({ title: t("devices.created"), lines: keyLines(r) })}
        />
      )}
      {history && <HistoryDialog device={history} onClose={() => setHistory(null)} />}
      {archiving && (
        <Modal
          open
          onClose={() => setArchiving(null)}
          title={t("devices.archive")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setArchiving(null)}>
                {t("cancel")}
              </Button>
              <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate(archiving)}>
                {t("devices.archive")}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t("devices.archiveConfirm", { name: archiving.name })}</p>
        </Modal>
      )}
      {secret && <SecretOnce title={secret.title} lines={secret.lines} onClose={() => setSecret(null)} />}
    </>
  );
}

function DeviceDrawer({
  device,
  onClose,
  onCreated,
}: {
  device: DeviceDto | null;
  onClose: () => void;
  onCreated: (r: { device: DeviceDto; webhookKey: string; webhookPath: string }) => void;
}) {
  const t = useTranslations("attendance");
  const api = useApi();
  const bridges = useQuery({ queryKey: ["bridge-agents"], queryFn: () => api.get<BridgeAgentDto[]>("/bridge-agents") });
  const [d, setD] = useState({
    name: device?.name ?? "",
    serialNumber: device?.serialNumber ?? "",
    ipAddress: device?.ipAddress ?? "",
    port: String(device?.port ?? 80),
    username: device?.username ?? "admin",
    password: "",
    direction: device?.direction ?? "IN",
    location: device?.location ?? "",
    useBridge: device?.useBridge ?? true,
    bridgeAgentId: device?.bridgeAgentId ?? "",
    isActive: device?.isActive ?? true,
  });
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const save = useSave(
    async () => {
      const body = {
        name: d.name,
        serialNumber: d.serialNumber || null,
        ipAddress: d.ipAddress || null,
        port: Number(d.port),
        username: d.username || null,
        ...(d.password ? { password: d.password } : {}),
        direction: d.direction,
        location: d.location || null,
        useBridge: d.useBridge,
        bridgeAgentId: d.useBridge ? d.bridgeAgentId || null : null,
        isActive: d.isActive,
      };
      if (device) return api.put(`/devices/${device.id}`, body);
      onCreated(await api.post(`/devices`, body));
    },
    KEYS,
    onClose,
  );
  return (
    <FormDrawer
      title={device ? t("devices.edit") : t("devices.add")}
      formId="device"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="device"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("devices.name")}>
          {(id) => (
            <Input id={id} required maxLength={60} value={d.name} onChange={(e) => set({ name: e.target.value })} />
          )}
        </Field>
        <Field label={t("devices.direction")} hint={t("devices.directionHint")}>
          {(id) => (
            <Select
              id={id}
              value={d.direction}
              onChange={(e) => set({ direction: e.target.value as typeof d.direction })}
            >
              {(["IN", "OUT", "BOTH"] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`direction.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("devices.location")}>
          {(id) => (
            <Input id={id} maxLength={120} value={d.location} onChange={(e) => set({ location: e.target.value })} />
          )}
        </Field>
        <Field label={t("devices.serial")} hint={t("devices.serialHint")}>
          {(id) => (
            <Input
              id={id}
              maxLength={64}
              value={d.serialNumber}
              onChange={(e) => set({ serialNumber: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label={t("devices.ip")}>
              {(id) => <Input id={id} value={d.ipAddress} onChange={(e) => set({ ipAddress: e.target.value })} />}
            </Field>
          </div>
          <Field label={t("devices.port")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={65535}
                value={d.port}
                onChange={(e) => set({ port: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("devices.username")}>
            {(id) => (
              <Input
                id={id}
                autoComplete="off"
                value={d.username}
                onChange={(e) => set({ username: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("devices.password")} hint={device?.hasPassword ? t("devices.passwordKept") : undefined}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={d.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Check label={t("devices.useBridge")} checked={d.useBridge} onChange={(v) => set({ useBridge: v })} />
        {d.useBridge && (
          <Field label={t("devices.bridge")}>
            {(id) => (
              <Select id={id} required value={d.bridgeAgentId} onChange={(e) => set({ bridgeAgentId: e.target.value })}>
                <option value="">—</option>
                {(bridges.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Check label={t("devices.active")} checked={d.isActive} onChange={(v) => set({ isActive: v })} />
      </form>
    </FormDrawer>
  );
}

function HistoryDialog({ device, onClose }: { device: DeviceDto; onClose: () => void }) {
  const t = useTranslations("attendance");
  const api = useApi();
  const today = schoolToday();
  const [from, setFrom] = useState<string>(addSchoolDays(today, -1));
  const [to, setTo] = useState<string>(today);
  const run = useSave(() => api.post(`/devices/${device.id}/history`, { from, to }), KEYS, onClose);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("devices.history")}
      footer={
        <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>
          {t("devices.historyRun")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("devices.historyHint")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("devices.from")}>
            {(id) => <Input id={id} type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label={t("devices.to")}>
            {(id) => <Input id={id} type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Bridges({
  onSecret,
}: {
  onSecret: (s: { title: string; lines: { label: string; value: string }[] }) => void;
}) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const api = useApi();
  const bridges = useQuery({
    queryKey: ["bridge-agents"],
    queryFn: () => api.get<BridgeAgentDto[]>("/bridge-agents"),
    refetchInterval: 30_000,
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const create = useSave(
    async () => {
      const r = await api.post<{ agent: BridgeAgentDto; token: string }>("/bridge-agents", { name });
      onSecret({ title: t("bridges.created"), lines: [{ label: t("bridges.token"), value: r.token }] });
    },
    KEYS,
    () => setAdding(false),
  );
  const rotate = useSave(async (b: BridgeAgentDto) => {
    const r = await api.post<{ agent: BridgeAgentDto; token: string }>(`/bridge-agents/${b.id}/rotate-token`);
    onSecret({ title: t("bridges.newToken"), lines: [{ label: t("bridges.token"), value: r.token }] });
  }, KEYS);
  const toggle = useSave(
    (b: BridgeAgentDto) => api.put(`/bridge-agents/${b.id}`, { name: b.name, isActive: !b.isActive }),
    KEYS,
  );
  return (
    <Card className="mb-4">
      <CardHeader
        title={t("bridges.title")}
        action={
          <Button size="sm" variant="secondary" onClick={() => (setName(""), setAdding(true))}>
            <Server className="size-4" aria-hidden />
            {t("bridges.add")}
          </Button>
        }
      />
      <p className="px-5 pb-3 text-sm text-muted">{t("bridges.help")}</p>
      <QueryBoundary query={bridges} isEmpty={(l) => l.length === 0} empty={<EmptyState text={t("bridges.empty")} />}>
        {(list) => (
          <DataTable
            testId="bridges"
            rows={list}
            columns={[
              {
                key: "name",
                header: t("devices.name"),
                primary: true,
                cell: (b) => (
                  <span className={b.isActive ? "" : "text-muted line-through"}>
                    <span className="font-medium">{b.name}</span>
                    <span className="ml-2 text-xs text-muted">
                      {[b.hostname, b.version && `v${b.version}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                ),
              },
              {
                key: "connection",
                header: t("devices.connection"),
                cell: (b) => (
                  <span className="flex flex-col gap-0.5">
                    <ConnectionBadge value={b.connection} />
                    <span className="text-xs text-muted">{formatDateTime(b.lastSeenAt, locale)}</span>
                  </span>
                ),
              },
              {
                key: "queue",
                header: t("bridges.queue"),
                cell: (b) =>
                  t("bridges.queueText", { jobs: b.pendingJobs, outbox: b.queueDepth ?? 0, devices: b.deviceCount }),
              },
              {
                key: "actions",
                header: "",
                cell: (b) => (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => rotate.mutate(b)}>
                      <KeyRound className="size-4" aria-hidden />
                      {t("bridges.rotate")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle.mutate(b)}>
                      {b.isActive ? t("bridges.disable") : t("bridges.enable")}
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {adding && (
        <Modal
          open
          onClose={() => setAdding(false)}
          title={t("bridges.add")}
          footer={
            <Button form="bridge-new" type="submit" loading={create.isPending}>
              {t("bridges.create")}
            </Button>
          }
        >
          <form id="bridge-new" onSubmit={(e: FormEvent) => (e.preventDefault(), create.mutate(undefined))}>
            <Field label={t("devices.name")}>
              {(id) => <Input id={id} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function Events() {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const api = useApi();
  const [date, setDate] = useState<string>(schoolToday());
  const [unmatched, setUnmatched] = useState(false);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ date, page: String(page), pageSize: "25" });
  if (unmatched) params.set("unmatched", "true");
  const events = useQuery({
    queryKey: ["access-events", params.toString()],
    queryFn: () => api.get<Page<AccessEventDto>>(`/attendance/events?${params.toString()}`),
  });
  return (
    <Card>
      <CardHeader title={t("events.title")} />
      <Toolbar>
        <Field label={t("journal.date")}>
          {(id) => (
            <Input
              id={id}
              type="date"
              max={schoolToday()}
              value={date}
              onChange={(e) => e.target.value && (setDate(e.target.value), setPage(1))}
            />
          )}
        </Field>
        <Check label={t("events.unmatched")} checked={unmatched} onChange={(v) => (setUnmatched(v), setPage(1))} />
      </Toolbar>
      <QueryBoundary
        query={events}
        isEmpty={(l) => l.items.length === 0}
        empty={<EmptyState text={t("events.empty")} />}
      >
        {(l) => (
          <>
            <DataTable
              testId="access-events"
              rows={l.items}
              columns={[
                {
                  key: "time",
                  header: t("events.time"),
                  primary: true,
                  cell: (e) => <span className="tabular font-medium">{formatTime(e.occurredAt, locale)}</span>,
                },
                {
                  key: "who",
                  header: t("journal.student"),
                  cell: (e) =>
                    e.studentName ?? (
                      <span className="text-warning">{t("events.unknownCode", { code: e.employeeNo })}</span>
                    ),
                },
                {
                  key: "device",
                  header: t("events.device"),
                  cell: (e) => `${e.deviceName}${e.direction ? ` · ${t(`direction.${e.direction}`)}` : ""}`,
                },
                {
                  key: "source",
                  header: t("events.source"),
                  cell: (e) => (
                    <Badge tone={e.source === "HISTORY" ? "warning" : "neutral"}>
                      {t(`events.sources.${e.source}`)}
                    </Badge>
                  ),
                },
              ]}
            />
            <Pagination page={l.page} pageSize={l.pageSize} total={l.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
    </Card>
  );
}
