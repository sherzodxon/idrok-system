"use client";

// Face Check (MASTER_SPEC §11): every active student, the face photo on the server and its state on every terminal;
// upload / replace / remove, send again, ask the terminals. Photos are fetched with the session (never public URLs).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ScanFace, Search, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FaceProfileDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useClassGroups } from "@/lib/queries";
import { useSave } from "@/lib/use-save";
import { FaceBadge, formatDateTime } from "./common";

type Overall = FaceProfileDto["overall"];
const OVERALL: Overall[] = ["NONE", "PENDING", "FAILED", "SYNCED"];

interface FacePage {
  items: FaceProfileDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
}

/** The server's face photo, loaded with the session; `version` busts the cache after a change. */
function FacePhoto({ studentId, version, className }: { studentId: string; version: number; className?: string }) {
  const api = useApi();
  const t = useTranslations("attendance");
  const photo = useQuery({
    queryKey: ["face-photo", studentId, version],
    queryFn: () => api.download(`/face/students/${studentId}/photo`),
    staleTime: 3_600_000,
  });
  const url = useMemo(() => (photo.data ? URL.createObjectURL(photo.data.blob) : null), [photo.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!url) return <div className={className} aria-hidden />;
  return <img src={url} alt={t("faces.photoAlt")} className={className} />;
}

export function FaceCheck() {
  const t = useTranslations("attendance");
  const api = useApi();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const [q, setQ] = useState("");
  const [classGroupId, setClassGroupId] = useState("");
  const [overall, setOverall] = useState<Overall | "">("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (q) params.set("q", q);
  if (classGroupId) params.set("classGroupId", classGroupId);
  if (overall) params.set("overall", overall);
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
                            studentId={p.studentId}
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
                  { key: "overall", header: t("faces.state"), cell: (p) => <FaceBadge value={p.overall} /> },
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
      {open && <FaceDialog studentId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function FaceDialog({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const api = useApi();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const profile = useQuery({
    queryKey: ["face-profile", studentId],
    queryFn: () => api.get<FaceProfileDto>(`/face/students/${studentId}`),
    refetchInterval: (q) =>
      q.state.data?.devices.some((d) => d.status === "PENDING" || d.status === "IN_PROGRESS") ? 5_000 : false,
  });
  const keys = ["face-profile", "face-profiles", "attendance-monitoring"];
  const upload = useSave((file: File) => {
    const form = new FormData();
    form.set("file", file);
    return api.put(`/face/students/${studentId}/photo`, form);
  }, keys);
  const remove = useSave(() => api.delete(`/face/students/${studentId}/photo`), keys);
  const resync = useSave(() => api.post(`/face/students/${studentId}/resync`, {}), keys);
  const check = useSave(() => api.post(`/face/students/${studentId}/check`), keys);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <Modal open onClose={onClose} side="right" title={t("faces.title")}>
      <QueryBoundary query={profile}>
        {(p) => (
          <div className="flex flex-col gap-4" data-testid="face-dialog">
            <div>
              <p className="font-semibold">{`${p.lastName} ${p.firstName}`}</p>
              <p className="text-sm text-muted">
                {p.studentCode}
                {p.className ? ` · ${p.className}` : ""}
              </p>
            </div>
            {p.hasPhoto ? (
              <FacePhoto
                studentId={p.studentId}
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
                          void qc.invalidateQueries({ queryKey: ["face-photo", studentId] });
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
