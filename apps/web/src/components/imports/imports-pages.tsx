"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FileSpreadsheet, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { importLabelsRu, importLabelsUz, type ImportJobDto, type Page } from "@idrok/shared";
import { useApi, useApiUrl } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PageHeader, Tabs } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { useYears } from "@/lib/queries";
import { useErrorText } from "@/lib/use-error-text";
import { useListState } from "@/lib/use-list-state";

const KINDS = ["STUDENTS_GUARDIANS", "EMPLOYEES_ASSIGNMENTS", "CLASS_GROUPS", "SUBJECTS"] as const;
type Kind = (typeof KINDS)[number];
const NEEDS_YEAR: Kind[] = ["STUDENTS_GUARDIANS", "EMPLOYEES_ASSIGNMENTS", "CLASS_GROUPS"];
const RUNNING = ["UPLOADED", "PARSING", "COMMITTING"];

function StatusBadge({ status }: { status: ImportJobDto["status"] }) {
  const t = useTranslations("imports.status");
  const tone =
    status === "COMMITTED"
      ? "success"
      : status === "FAILED"
        ? "danger"
        : status === "PREVIEW_READY"
          ? "primary"
          : status === "CANCELLED"
            ? "neutral"
            : "warning";
  return <Badge tone={tone}>{t(status)}</Badge>;
}

function BackLink({ href = "/admin/imports" }: { href?: string }) {
  const t = useTranslations("common");
  return (
    <Link href={href} className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      {t("back")}
    </Link>
  );
}

// ---------------------------------------------------------------- history

export function ImportsHistory() {
  const t = useTranslations();
  const api = useApi();
  const router = useRouter();
  const format = useFormatter();
  const list = useListState();
  const imports = useQuery({
    queryKey: ["imports", list.apiQuery],
    queryFn: () => api.get<Page<ImportJobDto>>(`/imports?${list.apiQuery}`),
  });
  return (
    <>
      <PageHeader
        title={t("imports.title")}
        actions={
          <Button onClick={() => router.push("/admin/imports/new")} data-testid="import-new">
            <Plus className="size-4" aria-hidden />
            {t("imports.new")}
          </Button>
        }
      />
      <Card>
        <QueryBoundary
          query={imports}
          isEmpty={(p) => p.total === 0}
          empty={<EmptyState icon={<FileSpreadsheet className="size-6" aria-hidden />} text={t("imports.empty")} />}
        >
          {(p) => (
            <>
              <DataTable
                rows={p.items}
                onRowClick={(j) => router.push(`/admin/imports/${j.id}`)}
                columns={[
                  { key: "file", header: t("imports.file"), primary: true, cell: (j) => j.fileName },
                  { key: "kind", header: t("imports.kind"), cell: (j) => t(`imports.kinds.${j.kind}`) },
                  { key: "status", header: t("students.statusLabel"), cell: (j) => <StatusBadge status={j.status} /> },
                  {
                    key: "rows",
                    header: t("imports.rows"),
                    cell: (j) => <span className="tabular">{j.summary?.total ?? "—"}</span>,
                  },
                  {
                    key: "date",
                    header: t("common.date"),
                    cell: (j) => format.dateTime(new Date(j.createdAt), { dateStyle: "medium", timeStyle: "short" }),
                  },
                ]}
              />
              <Pagination
                page={p.page}
                pageSize={p.pageSize}
                total={p.total}
                onPage={(page) => list.update({ page }, false)}
              />
            </>
          )}
        </QueryBoundary>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- wizard

function Step({ n, title, children, done }: { n: number; title: string; children: ReactNode; done?: boolean }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-sm font-semibold",
            done ? "bg-success-soft text-success" : "bg-primary-soft text-primary-strong",
          )}
        >
          {n}
        </span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

export function ImportWizard() {
  const t = useTranslations();
  const api = useApi();
  const apiUrl = useApiUrl();
  const router = useRouter();
  const toast = useToast();
  const errorText = useErrorText();
  const years = useYears();
  const [kind, setKind] = useState<Kind | null>(null);
  const [yearId, setYearId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const activeYear = years.data?.find((y) => y.status === "ACTIVE");
  const year = yearId || activeYear?.id || "";
  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.set("kind", kind!);
      if (NEEDS_YEAR.includes(kind!) && year) body.set("options", JSON.stringify({ academicYearId: year }));
      body.set("file", file!);
      return api.post<ImportJobDto>("/imports", body);
    },
    onSuccess: (job) => router.push(`/admin/imports/${job.id}`),
    onError: (err) => toast("error", errorText(err)),
  });
  return (
    <>
      <PageHeader back={<BackLink />} title={t("imports.new")} />
      <div className="flex max-w-3xl flex-col gap-4">
        <Step n={1} title={t("imports.chooseKind")} done={!!kind}>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                data-kind={k}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-card border border-border p-4 text-left hover:border-primary",
                  kind === k && "border-primary bg-primary-soft",
                )}
              >
                <p className="font-medium">{t(`imports.kinds.${k}`)}</p>
                <p className="text-sm text-muted">{t(`imports.kindHints.${k}`)}</p>
              </button>
            ))}
          </div>
        </Step>
        {kind && (
          <Step n={2} title={t("imports.template")}>
            <p className="mb-3 text-sm text-muted">{t("imports.templateHint")}</p>
            <div className="flex flex-wrap gap-2">
              {(["uz", "ru"] as const).map((l) => (
                <a
                  key={l}
                  href={`${apiUrl}/imports/templates/${kind}?locale=${l}`}
                  className="inline-flex h-10 items-center gap-2 rounded-button border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
                >
                  <Download className="size-4" aria-hidden />
                  {t("imports.downloadTemplate", { locale: t(`locales.${l}`) })}
                </a>
              ))}
            </div>
          </Step>
        )}
        {kind && (
          <Step n={3} title={t("imports.upload")}>
            <div className="flex flex-col gap-4">
              {NEEDS_YEAR.includes(kind) && (
                <Field label={t("structure.year")}>
                  {(id) => (
                    <Select id={id} value={year} onChange={(e) => setYearId(e.target.value)}>
                      {(years.data ?? []).map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-border-strong p-6 text-center hover:border-primary">
                <Upload className="size-6 text-muted" aria-hidden />
                <span className="text-sm font-medium">{file ? file.name : t("imports.chooseFile")}</span>
                <span className="text-xs text-muted">{t("imports.fileHint")}</span>
                <input
                  type="file"
                  accept=".xlsx"
                  className="sr-only"
                  data-testid="import-file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button
                size="lg"
                disabled={!file || (NEEDS_YEAR.includes(kind) && !year)}
                loading={upload.isPending}
                onClick={() => upload.mutate()}
                data-testid="import-upload"
              >
                {t("imports.uploadAndCheck")}
              </Button>
            </div>
          </Step>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- detail: preview, commit, credentials

interface PreviewRow {
  rowNumber: number;
  status: "OK" | "WARNING" | "ERROR" | "SKIPPED";
  data: Record<string, unknown> | null;
  messages: { code: string; field?: string; params?: Record<string, unknown> }[];
}

function rowSummary(kind: ImportJobDto["kind"], data: Record<string, unknown> | null) {
  // Skipped rows (spare lessons of a plan template) have no data.
  const d = data ?? {};
  const s = (k: string) => (typeof d[k] === "string" || typeof d[k] === "number" ? String(d[k]) : "");
  if (kind === "CURRICULUM_PLAN") return d.topicTitle ? `${s("topicTitle")} · ${s("hours")}` : "—";
  if (kind === "QUESTIONS") return s("text") || "—";
  if (kind === "STUDENTS_GUARDIANS") return `${s("lastName")} ${s("firstName")} · ${s("className")}`;
  if (kind === "EMPLOYEES_ASSIGNMENTS") return `${s("lastName")} ${s("firstName")}`;
  if (kind === "CLASS_GROUPS") return `${s("level")}-${s("section")}`;
  return s("name");
}

/**
 * Preview, commit and result of one import. Curriculum plan imports reuse it from the plans pages (`backHref`,
 * `committed` shows the link to the created plan).
 */
export function ImportDetail({
  id,
  backHref,
  committed,
}: {
  id: string;
  backHref?: string;
  committed?: (job: ImportJobDto) => ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const errorText = useErrorText();
  const labels = locale === "ru" ? importLabelsRu : importLabelsUz;
  const [filter, setFilter] = useState<"ALL" | "ERROR" | "WARNING" | "OK">("ALL");
  const [page, setPage] = useState(1);
  const [skipErrors, setSkipErrors] = useState(false);
  const job = useQuery({
    queryKey: ["import", id],
    queryFn: () => api.get<ImportJobDto>(`/imports/${id}`),
    refetchInterval: (q) => (q.state.data && RUNNING.includes(q.state.data.status) ? 1000 : false),
  });
  const ready = job.data && !RUNNING.includes(job.data.status) && job.data.status !== "FAILED";
  const rows = useQuery({
    queryKey: ["import-rows", id, filter, page, job.data?.status],
    queryFn: () =>
      api.get<Page<PreviewRow>>(
        `/imports/${id}/rows?page=${page}&pageSize=50${filter === "ALL" ? "" : `&status=${filter}`}`,
      ),
    enabled: !!ready,
  });
  const commit = useMutation({
    mutationFn: () => api.post<ImportJobDto>(`/imports/${id}/commit`, { skipErrors }),
    onSuccess: (j) => qc.setQueryData(["import", id], j),
    onError: (err) => toast("error", errorText(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post<ImportJobDto>(`/imports/${id}/cancel`),
    onSuccess: (j) => qc.setQueryData(["import", id], j),
    onError: (err) => toast("error", errorText(err)),
  });
  const credentials = useMutation({
    mutationFn: () => api.download(`/imports/${id}/credentials`),
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      void qc.invalidateQueries({ queryKey: ["import", id] });
    },
    onError: (err) => toast("error", errorText(err)),
  });

  if (job.isPending) return <LoadingState />;
  if (!job.data) return <ErrorState error={job.error} onRetry={() => void job.refetch()} />;
  const j = job.data;
  const kind = j.kind;
  const isPlan = kind === "CURRICULUM_PLAN";
  const message = (m: PreviewRow["messages"][number]) => {
    const field = m.field ? ((labels.columns as Record<string, string>)[m.field]?.replace("*", "") ?? m.field) : "";
    const text = t.has(`imports.messages.${m.code}`)
      ? t(`imports.messages.${m.code}`, { value: String(m.params?.value ?? ""), row: String(m.params?.row ?? "") })
      : m.code;
    return field ? `${field}: ${text}` : text;
  };

  return (
    <>
      <PageHeader
        back={<BackLink href={backHref} />}
        title={j.fileName}
        subtitle={
          <span className="flex items-center gap-2">
            {t(`imports.kinds.${kind}`)} <StatusBadge status={j.status} />
          </span>
        }
      />
      <div className="flex flex-col gap-5">
        {RUNNING.includes(j.status) && (
          <Card className="p-5" data-testid="import-running">
            <p className="text-sm text-muted">
              {t(j.status === "COMMITTING" ? "imports.committing" : "imports.parsing")}
            </p>
          </Card>
        )}
        {j.status === "FAILED" && <ErrorStateBox code={j.failure?.code ?? "INTERNAL_ERROR"} />}
        {j.summary && (
          <div className="grid gap-3 sm:grid-cols-4" data-testid="import-summary">
            {(
              [
                "total",
                "ok",
                "warnings",
                "errors",
                "created",
                "updated",
                "skipped",
                "failed",
                "accounts",
                "hours",
                "lessons",
                "items",
              ] as const
            )
              .filter((k) => j.summary?.[k] !== undefined)
              .map((k) => (
                <Card key={k} className="p-4">
                  <p className="text-sm text-muted">{t(`imports.summary.${k}`)}</p>
                  <p className="tabular text-2xl font-bold" data-summary={k}>
                    {j.summary?.[k]}
                  </p>
                </Card>
              ))}
          </div>
        )}
        {isPlan && j.summary?.lessons !== undefined && j.summary.hours !== j.summary.lessons && (
          <Card className="border-warning p-4 text-sm" data-testid="import-hours-mismatch">
            {t("imports.hoursMismatch", { hours: j.summary.hours ?? 0, lessons: j.summary.lessons })}
          </Card>
        )}
        {j.status === "COMMITTED" && committed?.(j)}
        {j.status === "PREVIEW_READY" && (
          <Card className="flex flex-col gap-3 p-5">
            {isPlan && j.errorCount > 0 && <p className="text-sm text-danger">{t("imports.planHasErrors")}</p>}
            {!isPlan && j.errorCount > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skipErrors}
                  onChange={(e) => setSkipErrors(e.target.checked)}
                  data-testid="skip-errors"
                />
                {t("imports.skipErrors", { count: j.errorCount })}
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={j.errorCount > 0 && !skipErrors}
                loading={commit.isPending}
                onClick={() => commit.mutate()}
                data-testid="import-commit"
              >
                {t("imports.commit")}
              </Button>
              <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                {t("common.cancel")}
              </Button>
            </div>
          </Card>
        )}
        {j.status === "COMMITTED" && j.hasCredentials && (
          <Card className="flex flex-col gap-3 p-5">
            <p className="text-sm">{t("imports.credentialsHint")}</p>
            <Button
              variant="secondary"
              loading={credentials.isPending}
              onClick={() => credentials.mutate()}
              data-testid="import-credentials"
            >
              <Download className="size-4" aria-hidden />
              {t("imports.downloadCredentials")}
            </Button>
          </Card>
        )}
        {ready && (
          <Card>
            <CardHeader title={t("imports.preview")} />
            <div className="px-5 pt-3">
              <Tabs
                value={filter}
                onChange={(v) => (setFilter(v), setPage(1))}
                tabs={(["ALL", "ERROR", "WARNING", "OK"] as const).map((v) => ({
                  value: v,
                  label: t(`imports.filter.${v}`),
                }))}
              />
            </div>
            <QueryBoundary
              query={rows}
              isEmpty={(p) => p.total === 0}
              empty={<EmptyState text={t("imports.noRows")} />}
            >
              {(p) => (
                <>
                  <DataTable
                    testId="import-rows"
                    rows={p.items.map((r) => ({ ...r, id: String(r.rowNumber) }))}
                    columns={[
                      {
                        key: "row",
                        header: t("imports.row"),
                        cell: (r) => <span className="tabular">{r.rowNumber}</span>,
                      },
                      {
                        key: "data",
                        header: t("imports.record"),
                        primary: true,
                        cell: (r) => rowSummary(kind, r.data),
                      },
                      {
                        key: "status",
                        header: t("students.statusLabel"),
                        cell: (r) => (
                          <Badge
                            tone={
                              r.status === "ERROR"
                                ? "danger"
                                : r.status === "WARNING"
                                  ? "warning"
                                  : r.status === "OK"
                                    ? "success"
                                    : "neutral"
                            }
                          >
                            {t(`imports.rowStatus.${r.status}`)}
                          </Badge>
                        ),
                      },
                      {
                        key: "messages",
                        header: t("imports.messagesLabel"),
                        cell: (r) => (
                          <ul className="flex flex-col gap-0.5">
                            {r.messages.map((m, i) => (
                              <li
                                key={i}
                                className={cn("text-sm", r.status === "ERROR" ? "text-danger" : "text-muted")}
                              >
                                {message(m)}
                              </li>
                            ))}
                          </ul>
                        ),
                      },
                    ]}
                  />
                  <Pagination page={p.page} pageSize={p.pageSize} total={p.total} onPage={setPage} />
                </>
              )}
            </QueryBoundary>
          </Card>
        )}
      </div>
    </>
  );
}

function ErrorStateBox({ code }: { code: string }) {
  const t = useTranslations("imports");
  return (
    <Card className="border-danger p-5" role="alert" data-testid="import-failed">
      <p className="font-semibold text-danger">{t("failed")}</p>
      <p className="text-sm text-muted">{t.has(`failures.${code}`) ? t(`failures.${code}`) : code}</p>
    </Card>
  );
}
