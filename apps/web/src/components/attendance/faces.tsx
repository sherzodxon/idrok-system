"use client";

// Face Check (MASTER_SPEC §11): every active student, the face photo on the server and its state on every terminal;
// upload / replace / remove, send again, ask the terminals. Photos are fetched with the session (never public URLs).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ScanFace, Search, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FaceProfileDto, StaffFaceDto, StudentDetail } from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useClassGroups } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { useSave } from "@/lib/use-save";
import { FaceBadge, formatDateTime, useFormatDay } from "./common";

type Overall = FaceProfileDto["overall"];
const OVERALL: Overall[] = ["NONE", "PENDING", "FAILED", "SYNCED"];

type Kind = "STUDENT" | "EMPLOYEE";
const basePath = (kind: Kind, id: string) => (kind === "STUDENT" ? `/face/students/${id}` : `/face/employees/${id}`);

interface StaffPage {
  items: StaffFaceDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
}

interface FacePage {
  items: FaceProfileDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  noConsent: number;
  consentRequired: boolean;
  consentGraceEndsOn: string | null;
}

/** The server's face photo, loaded with the session; `version` busts the cache after a change. */
function FacePhoto({
  kind = "STUDENT",
  id,
  version,
  className,
}: {
  kind?: Kind;
  id: string;
  version: number;
  className?: string;
}) {
  const api = useApi();
  const t = useTranslations("attendance");
  const photo = useQuery({
    queryKey: ["face-photo", id, version],
    queryFn: () => api.download(`${basePath(kind, id)}/photo`),
    staleTime: 3_600_000,
  });
  const url = useMemo(() => (photo.data ? URL.createObjectURL(photo.data.blob) : null), [photo.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!url) return <div className={className} aria-hidden />;
  return <img src={url} alt={t("faces.photoAlt")} className={className} />;
}

/** Face Check: students and staff (T-76) in two tabs. */
export function FaceCheck() {
  const t = useTranslations("attendance.faces");
  const [who, setWho] = useState<Kind>("STUDENT");
  return (
    <>
      <div className="mb-4">
        <Tabs
          tabs={[
            { value: "STUDENT" as const, label: t("students") },
            { value: "EMPLOYEE" as const, label: t("staff") },
          ]}
          value={who}
          onChange={setWho}
        />
      </div>
      {who === "STUDENT" ? <StudentFaces /> : <StaffFaces />}
    </>
  );
}

function StudentFaces() {
  const t = useTranslations("attendance");
  const api = useApi();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const [q, setQ] = useState("");
  const [classGroupId, setClassGroupId] = useState("");
  const [overall, setOverall] = useState<Overall | "">("");
  const [noConsentOnly, setNoConsentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (q) params.set("q", q);
  if (classGroupId) params.set("classGroupId", classGroupId);
  if (overall) params.set("overall", overall);
  if (noConsentOnly) params.set("consent", "missing");
  const list = useQuery({
    queryKey: ["face-profiles", params.toString()],
    queryFn: () => api.get<FacePage>(`/face/profiles?${params.toString()}`),
  });
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };
  return (
    <>
      <Card className="mb-4">
        <Toolbar>
          <SearchInput value={q} onChange={reset(setQ)} label={t("journal.search")} />
          <FilterSelect
            label={t("journal.class")}
            allLabel={t("journal.allClasses")}
            value={classGroupId}
            onChange={reset(setClassGroupId)}
            options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Toolbar>
      </Card>
      <Tabs
        tabs={[
          { value: "" as const, label: t("faces.all") },
          ...OVERALL.map((o) => ({ value: o, label: `${t(`face.${o}`)} · ${list.data?.counts[o] ?? 0}` })),
        ]}
        value={overall}
        onChange={reset(setOverall)}
      />
      {list.data?.consentRequired && (list.data.noConsent > 0 || noConsentOnly) && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-card border border-warning bg-warning-soft p-3 text-sm text-warning"
          data-testid="no-consent-banner"
        >
          <span className="min-w-0 flex-1 font-medium">
            {list.data.consentGraceEndsOn && list.data.consentGraceEndsOn >= schoolToday()
              ? t("faces.noConsentUntil", { n: list.data.noConsent, date: formatDate(list.data.consentGraceEndsOn) })
              : t("faces.noConsentNow", { n: list.data.noConsent })}
          </span>
          <Button size="sm" variant="secondary" onClick={() => reset(setNoConsentOnly)(!noConsentOnly)}>
            {noConsentOnly ? t("faces.showAll") : t("faces.showNoConsent")}
          </Button>
        </div>
      )}
      <Card>
        <QueryBoundary
          query={list}
          isEmpty={(l) => l.items.length === 0}
          empty={<EmptyState text={t("faces.empty")} />}
        >
          {(l) => (
            <>
              <DataTable
                testId="face-profiles"
                rows={l.items.map((p) => ({ ...p, id: p.studentId }))}
                onRowClick={(p) => setOpen(p.studentId)}
                columns={[
                  {
                    key: "student",
                    header: t("journal.student"),
                    primary: true,
                    cell: (p) => (
                      <span className="flex items-center gap-3">
                        {p.hasPhoto ? (
                          <FacePhoto
                            id={p.studentId}
                            version={p.version ?? 0}
                            className="size-10 shrink-0 rounded-full bg-surface-muted object-cover"
                          />
                        ) : (
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted">
                            <ScanFace className="size-5" aria-hidden />
                          </span>
                        )}
                        <span>
                          <span className="block font-medium">{`${p.lastName} ${p.firstName}`}</span>
                          <span className="text-xs text-muted">
                            {p.studentCode}
                            {p.className ? ` · ${p.className}` : ""}
                          </span>
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "overall",
                    header: t("faces.state"),
                    cell: (p) => (
                      <span className="flex flex-wrap items-center gap-1">
                        <FaceBadge value={p.overall} />
                        {p.hasPhoto && !p.consent && <Badge tone="warning">{t("faces.noConsentBadge")}</Badge>}
                      </span>
                    ),
                  },
                  {
                    key: "devices",
                    header: t("faces.devices"),
                    cell: (p) =>
                      p.devices.length ? (
                        <span className="flex flex-wrap gap-1">
                          {p.devices.map((d) => (
                            <span key={d.deviceId} className="text-xs text-muted">
                              {d.deviceName}: {t(`face.${d.status}`)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        "—"
                      ),
                  },
                ]}
              />
              <Pagination page={l.page} pageSize={l.pageSize} total={l.total} onPage={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>
      {open && <FaceDialog kind="STUDENT" id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function StaffFaces() {
  const t = useTranslations("attendance");
  const api = useApi();
  const [q, setQ] = useState("");
  const [overall, setOverall] = useState<Overall | "">("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (q) params.set("q", q);
  if (overall) params.set("overall", overall);
  const list = useQuery({
    queryKey: ["face-profiles", "staff", params.toString()],
    queryFn: () => api.get<StaffPage>(`/face/employees?${params.toString()}`),
  });
  return (
    <>
      <Card className="mb-4">
        <Toolbar>
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            label={t("faces.searchStaff")}
          />
        </Toolbar>
      </Card>
      <Tabs
        tabs={[
          { value: "" as const, label: t("faces.all") },
          ...OVERALL.map((o) => ({ value: o, label: `${t(`face.${o}`)} · ${list.data?.counts[o] ?? 0}` })),
        ]}
        value={overall}
        onChange={(v) => {
          setOverall(v);
          setPage(1);
        }}
      />
      <Card>
        <QueryBoundary
          query={list}
          isEmpty={(l) => l.items.length === 0}
          empty={<EmptyState text={t("faces.emptyStaff")} />}
        >
          {(l) => (
            <>
              <DataTable
                testId="staff-faces"
                rows={l.items.map((p) => ({ ...p, id: p.employeeId }))}
                onRowClick={(p) => setOpen(p.employeeId)}
                columns={[
                  {
                    key: "employee",
                    header: t("faces.employee"),
                    primary: true,
                    cell: (p) => (
                      <span className="flex items-center gap-3">
                        {p.hasPhoto ? (
                          <FacePhoto
                            kind="EMPLOYEE"
                            id={p.employeeId}
                            version={p.version ?? 0}
                            className="size-10 shrink-0 rounded-full bg-surface-muted object-cover"
                          />
                        ) : (
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted">
                            <ScanFace className="size-5" aria-hidden />
                          </span>
                        )}
                        <span>
                          <span className="block font-medium">{`${p.lastName} ${p.firstName}`}</span>
                          <span className="text-xs text-muted">
                            {[p.employeeCode, p.positionTitle].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "ready",
                    header: t("faces.requirements"),
                    cell: (p) =>
                      p.phone && p.employeeCode ? (
                        <span className="text-xs text-muted">{p.phone}</span>
                      ) : (
                        <Badge tone="warning">{t("faces.cardIncomplete")}</Badge>
                      ),
                  },
                  { key: "overall", header: t("faces.state"), cell: (p) => <FaceBadge value={p.overall} /> },
                ]}
              />
              <Pagination page={l.page} pageSize={l.pageSize} total={l.total} onPage={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>
      {open && <FaceDialog kind="EMPLOYEE" id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** T-75: the guardian's consent in force, a form to record one, and revoking it (which removes the face). */
function ConsentSection({ profile }: { profile: FaceProfileDto }) {
  const t = useTranslations("attendance.faces.consent");
  const tc = useTranslations("common");
  const api = useApi();
  const qc = useQueryClient();
  const day = useFormatDay();
  const keys = ["face-profile", "face-profiles", "attendance-monitoring"];
  const student = useQuery({
    queryKey: ["student", profile.studentId],
    queryFn: () => api.get<StudentDetail>(`/students/${profile.studentId}`),
    enabled: !profile.consent,
  });
  const [form, setForm] = useState({ guardianId: "", givenBy: "", givenOn: schoolToday() });
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const record = useSave(
    () =>
      api.post(`/face/students/${profile.studentId}/consents`, {
        guardianId: form.guardianId || null,
        givenBy: form.givenBy,
        givenOn: form.givenOn,
      }),
    keys,
  );
  const revoke = useSave(
    () => api.post(`/face/students/${profile.studentId}/consents/revoke`, { reason }),
    keys,
    () => {
      setRevoking(false);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["face-photo", profile.studentId] });
    },
  );
  if (profile.consent)
    return (
      <div
        className="flex flex-wrap items-center gap-3 rounded-card border border-border p-3"
        data-testid="face-consent"
      >
        <Badge tone="success">{t("given")}</Badge>
        <span className="min-w-0 flex-1 text-sm">
          {t("givenBy", { name: profile.consent.givenBy, date: day(profile.consent.givenOn) })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setRevoking(true)}>
          {t("revoke")}
        </Button>
        <Modal
          open={revoking}
          onClose={() => setRevoking(false)}
          title={t("revoke")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRevoking(false)}>
                {tc("cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={reason.trim().length < 3}
                loading={revoke.isPending}
                onClick={() => revoke.mutate(undefined)}
                data-testid="revoke-consent"
              >
                {t("revoke")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t("revokeText")}</p>
            <Input
              aria-label={t("reason")}
              placeholder={t("reason")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </Modal>
      </div>
    );
  const guardians = student.data?.guardians ?? [];
  return (
    <div
      className="flex flex-col gap-3 rounded-card border border-warning bg-warning-soft p-3"
      data-testid="face-consent"
    >
      <p className="text-sm font-medium text-warning">{t("missing")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {guardians.length > 0 && (
          <Select
            aria-label={t("guardian")}
            value={form.guardianId}
            onChange={(e) => setForm({ ...form, guardianId: e.target.value })}
          >
            <option value="">{t("otherPerson")}</option>
            {guardians.map((g) => (
              <option key={g.guardianId} value={g.guardianId}>{`${g.lastName} ${g.firstName}`}</option>
            ))}
          </Select>
        )}
        {!form.guardianId && (
          <Input
            aria-label={t("givenByLabel")}
            placeholder={t("givenByLabel")}
            value={form.givenBy}
            onChange={(e) => setForm({ ...form, givenBy: e.target.value })}
          />
        )}
        <Input
          type="date"
          aria-label={t("date")}
          value={form.givenOn}
          max={schoolToday()}
          onChange={(e) => setForm({ ...form, givenOn: e.target.value as typeof form.givenOn })}
        />
      </div>
      <div>
        <Button
          size="sm"
          disabled={!form.guardianId && !form.givenBy.trim()}
          loading={record.isPending}
          onClick={() => record.mutate(undefined)}
          data-testid="record-consent"
        >
          {t("record")}
        </Button>
      </div>
    </div>
  );
}

function FaceDialog({ kind, id, onClose }: { kind: Kind; id: string; onClose: () => void }) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const api = useApi();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const base = basePath(kind, id);
  const profile = useQuery({
    queryKey: ["face-profile", id],
    queryFn: () => api.get<FaceProfileDto | StaffFaceDto>(base),
    refetchInterval: (q) =>
      q.state.data?.devices.some((d) => d.status === "PENDING" || d.status === "IN_PROGRESS") ? 5_000 : false,
  });
  const keys = ["face-profile", "face-profiles", "attendance-monitoring"];
  const upload = useSave((file: File) => {
    const form = new FormData();
    form.set("file", file);
    return api.put(`${base}/photo`, form);
  }, keys);
  const remove = useSave(() => api.delete(`${base}/photo`), keys);
  const resync = useSave(() => api.post(`${base}/resync`, {}), keys);
  const check = useSave(() => api.post(`${base}/check`), keys);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <Modal open onClose={onClose} side="right" title={t("faces.title")}>
      <QueryBoundary query={profile}>
        {(p) => (
          <div className="flex flex-col gap-4" data-testid="face-dialog">
            <div>
              <p className="font-semibold">{`${p.lastName} ${p.firstName}`}</p>
              <p className="text-sm text-muted">
                {"studentId" in p
                  ? `${p.studentCode}${p.className ? ` · ${p.className}` : ""}`
                  : [p.employeeCode, p.positionTitle, p.phone].filter(Boolean).join(" · ")}
              </p>
            </div>
            {"studentId" in p ? (
              <ConsentSection profile={p} />
            ) : (
              (!p.phone || !p.employeeCode) && (
                <p
                  className="rounded-card border border-warning bg-warning-soft p-3 text-sm font-medium text-warning"
                  data-testid="staff-card-incomplete"
                >
                  {t("faces.staffNeeds")}
                </p>
              )
            )}
            {p.hasPhoto ? (
              <FacePhoto
                kind={kind}
                id={id}
                version={p.version ?? 0}
                className="aspect-[3/4] w-full max-w-xs rounded-card bg-surface-muted object-cover"
              />
            ) : (
              <EmptyState icon={<ScanFace className="size-6" aria-hidden />} text={t("faces.noPhoto")} />
            )}
            <p className="text-xs text-muted">{t("faces.photoHint")}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              data-testid="face-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" aria-hidden />
                {p.hasPhoto ? t("faces.replace") : t("faces.upload")}
              </Button>
              {p.hasPhoto && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={resync.isPending}
                    onClick={() => resync.mutate(undefined)}
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    {t("faces.resync")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={check.isPending}
                    onClick={() => check.mutate(undefined)}
                  >
                    <Search className="size-4" aria-hidden />
                    {t("faces.check")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setConfirmRemove(true)}>
                    <Trash2 className="size-4" aria-hidden />
                    {t("faces.remove")}
                  </Button>
                </>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t("faces.devices")}</h3>
              {p.devices.length === 0 ? (
                <p className="text-sm text-muted">{t("faces.notSent")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-card border border-border" data-testid="face-devices">
                  {p.devices.map((d) => (
                    <li key={d.deviceId} className="flex flex-col gap-1 px-3 py-2 text-sm">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{d.deviceName}</span>
                        <FaceBadge value={d.status} />
                      </span>
                      <span className="text-xs text-muted">
                        {d.action === "DELETE" ? t("faces.removal") : t("faces.upsert")}
                        {" · "}
                        {t("faces.syncedAt", { at: formatDateTime(d.syncedAt, locale) })}
                        {d.deviceHasFace !== null &&
                          ` · ${d.deviceHasFace ? t("faces.onDevice") : t("faces.notOnDevice")} (${formatDateTime(d.lastCheckedAt, locale)})`}
                      </span>
                      {d.lastError && <span className="text-xs text-danger">{d.lastError}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Modal
              open={confirmRemove}
              onClose={() => setConfirmRemove(false)}
              title={t("faces.remove")}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                    {t("cancel")}
                  </Button>
                  <Button
                    variant="danger"
                    loading={remove.isPending}
                    onClick={() =>
                      remove.mutate(undefined, {
                        onSuccess: () => {
                          setConfirmRemove(false);
                          void qc.invalidateQueries({ queryKey: ["face-photo", id] });
                        },
                      })
                    }
                  >
                    {t("faces.remove")}
                  </Button>
                </>
              }
            >
              <p className="text-sm">{t("faces.removeConfirm")}</p>
            </Modal>
          </div>
        )}
      </QueryBoundary>
    </Modal>
  );
}
