"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Download, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type {
  AcademicPeriodDto,
  CurriculumPlanDetailDto,
  CurriculumPlanSummaryDto,
  ImportJobDto,
  PlanAssignmentDto,
  LessonTypeCode,
  Page,
  PlanItemInput,
  TeacherAssignmentDto,
  TopicDto,
} from "@idrok/shared";
import { ImportDetail } from "@/components/imports/imports-pages";
import { ReflowDialog } from "@/components/lessons/lessons-pages";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useClassGroups, useGrades, useSubjects } from "@/lib/queries";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";

const STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ARCHIVED"] as const;
const LESSON_TYPES: LessonTypeCode[] = ["NEW", "PRACTICE", "REVIEW", "CONTROL_WORK", "BSB", "CHSB", "LAB", "OTHER"];
const TONE = {
  DRAFT: "neutral",
  SUBMITTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  ARCHIVED: "neutral",
} as const;

export function PlanStatusBadge({ status }: { status: CurriculumPlanSummaryDto["status"] }) {
  const t = useTranslations("plans.status");
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
}

// ---------------------------------------------------------------- list

export function PlansList({ basePath, mine }: { basePath: string; mine: boolean }) {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const router = useRouter();
  const list = useListState(["status"] as const);
  const status = list.filters.status;
  const plans = useQuery({
    queryKey: ["curriculum-plans", mine, list.apiQuery],
    // apiQuery carries the status filter.
    queryFn: () =>
      api.get<Page<CurriculumPlanSummaryDto>>(`/curriculum-plans?${list.apiQuery}${mine ? "&mine=true" : ""}`),
  });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  return (
    <>
      <PageHeader
        title={t(mine ? "plans.myTitle" : "plans.title")}
        actions={
          can(me.data, "curriculum.create") && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)} data-testid="plan-import">
                <FileSpreadsheet className="size-4" aria-hidden />
                {t("plans.importExcel")}
              </Button>
              <Button onClick={() => setCreating(true)} data-testid="plan-create">
                <Plus className="size-4" aria-hidden />
                {t("plans.add")}
              </Button>
            </>
          )
        }
      />
      <Card>
        <Toolbar>
          <FilterSelect
            label={t("students.statusLabel")}
            allLabel={t("plans.allActive")}
            value={status}
            onChange={(v) => list.update({ status: v })}
            options={STATUSES.map((s) => ({ value: s, label: t(`plans.status.${s}`) }))}
          />
        </Toolbar>
        <QueryBoundary
          query={plans}
          isEmpty={(p) => p.total === 0}
          empty={<EmptyState text={t(mine ? "plans.emptyMine" : "plans.empty")} />}
        >
          {(p) => (
            <>
              <DataTable
                testId="plans-table"
                rows={p.items}
                onRowClick={(plan) => router.push(`${basePath}/${plan.id}`)}
                columns={[
                  { key: "title", header: t("plans.planTitle"), primary: true, cell: (x) => x.title },
                  { key: "subject", header: t("structure.subject"), cell: (x) => x.subjectName },
                  { key: "grade", header: t("structure.level"), cell: (x) => x.gradeName },
                  { key: "author", header: t("plans.author"), cell: (x) => x.authorName ?? "—" },
                  {
                    key: "hours",
                    header: t("plans.hours"),
                    cell: (x) => <span className="tabular">{x.totalHours}</span>,
                  },
                  {
                    key: "status",
                    header: t("students.statusLabel"),
                    cell: (x) => (
                      <span className="flex items-center gap-2">
                        <PlanStatusBadge status={x.status} />
                        <span className="text-xs text-muted">{t("plans.versionShort", { version: x.version })}</span>
                      </span>
                    ),
                  },
                ]}
              />
              <Pagination
                page={p.page}
                pageSize={p.pageSize}
                total={p.total}
                onPage={(n) => list.update({ page: n }, false)}
              />
            </>
          )}
        </QueryBoundary>
      </Card>
      {creating && (
        <CreatePlanDrawer onClose={() => setCreating(false)} onCreated={(id) => router.push(`${basePath}/${id}`)} />
      )}
      {importing && (
        <ImportPlanDrawer
          onClose={() => setImporting(false)}
          onUploaded={(jobId) => router.push(`${basePath}/imports/${jobId}`)}
        />
      )}
    </>
  );
}

/** Subjects, grades and class groups the caller may write plans for (teachers: what they teach; the API checks again). */
function usePlanTargets() {
  const api = useApi();
  const me = useMe();
  const year = useActiveYear();
  const subjects = useSubjects();
  const grades = useGrades();
  const classes = useClassGroups(year.data?.id);
  const employeeId = me.data?.profiles.employeeId;
  const school = can(me.data, "curriculum.approve") || can(me.data, "timetable.manage");
  const assignments = useQuery({
    queryKey: ["teacher-assignments", "mine", employeeId],
    queryFn: () =>
      api
        .get<Page<TeacherAssignmentDto>>(`/teacher-assignments?teacherId=${employeeId}&pageSize=100`)
        .then((p) => p.items.filter((a) => a.validTo === null)),
    enabled: !!employeeId && !school,
  });
  const gradeOfGroup = new Map((classes.data ?? []).map((c) => [c.classTeachingGroupId, c.gradeId]));
  const ownGroups = new Set((assignments.data ?? []).map((a) => a.teachingGroupId));
  const allowedSubjects = school ? null : new Set((assignments.data ?? []).map((a) => a.subjectId));
  const allowedGrades = school
    ? null
    : new Set((assignments.data ?? []).map((a) => gradeOfGroup.get(a.teachingGroupId)).filter(Boolean));
  return {
    year: year.data,
    subjects: (subjects.data ?? []).filter((x) => !allowedSubjects || allowedSubjects.has(x.id)),
    grades: (grades.data ?? []).filter((g) => !allowedGrades || allowedGrades.has(g.id)),
    /** Whole-class groups of a grade the caller may apply plans to. */
    classesOf: (gradeId: string) =>
      (classes.data ?? []).filter(
        (c) => c.gradeId === gradeId && c.classTeachingGroupId && (school || ownGroups.has(c.classTeachingGroupId)),
      ),
  };
}

function CreatePlanDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations();
  const api = useApi();
  const targets = usePlanTargets();
  const year = { data: targets.year };
  const [subjectId, setSubjectId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [title, setTitle] = useState("");
  const create = useSave(
    (body: object) => api.post<CurriculumPlanDetailDto>("/curriculum-plans", body).then((p) => onCreated(p.id)),
    ["curriculum-plans"],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (year.data) create.mutate({ academicYearId: year.data.id, subjectId, gradeId, title, items: [] });
  };
  return (
    <FormDrawer title={t("plans.add")} formId="plan-form" busy={create.isPending} onClose={onClose}>
      <form id="plan-form" className="flex flex-col gap-4" onSubmit={submit}>
        <p className="text-sm text-muted">{t("plans.addHint", { year: year.data?.name ?? "—" })}</p>
        <Field label={t("structure.subject")}>
          {(id) => (
            <Select
              id={id}
              required
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              data-testid="plan-subject"
            >
              <option value="">—</option>
              {targets.subjects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("structure.level")}>
          {(id) => (
            <Select
              id={id}
              required
              value={gradeId}
              onChange={(e) => setGradeId(e.target.value)}
              data-testid="plan-grade"
            >
              <option value="">—</option>
              {targets.grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("plans.planTitle")}>
          {(id) => (
            <Input
              id={id}
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="plan-title"
            />
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- editor

interface Row {
  key: number;
  topicTitle: string;
  hours: number;
  lessonType: LessonTypeCode;
  periodId: string;
  homework: string;
  objectives: string;
}

let rowKey = 0;
const toRows = (plan: CurriculumPlanDetailDto): Row[] =>
  plan.items.map((i) => ({
    key: ++rowKey,
    topicTitle: i.topicTitle,
    hours: i.hours,
    lessonType: i.lessonType,
    periodId: i.periodId ?? "",
    homework: i.homework ?? "",
    objectives: i.objectives ?? "",
  }));

export function PlanEditor({ id, backHref }: { id: string; backHref: string }) {
  const api = useApi();
  const plan = useQuery({
    queryKey: ["curriculum-plans", "detail", id],
    queryFn: () => api.get<CurriculumPlanDetailDto>(`/curriculum-plans/${id}`),
  });
  return (
    <QueryBoundary query={plan}>
      {(p) => <PlanEditorBody key={`${p.id}-${p.updatedAt}`} plan={p} backHref={backHref} />}
    </QueryBoundary>
  );
}

function PlanEditorBody({ plan, backHref }: { plan: CurriculumPlanDetailDto; backHref: string }) {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const router = useRouter();
  const editable = plan.canEdit && (plan.status === "DRAFT" || plan.status === "REJECTED");
  const approver = can(me.data, "curriculum.approve");
  const [title, setTitle] = useState(plan.title);
  const [rows, setRows] = useState<Row[]>(() => toRows(plan));
  const [dirty, setDirty] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const periods = useQuery({
    queryKey: ["periods", plan.academicYearId],
    queryFn: () => api.get<AcademicPeriodDto[]>(`/academic-years/${plan.academicYearId}/periods`),
  });
  const topics = useQuery({
    queryKey: ["topics", plan.subjectId, plan.gradeId],
    queryFn: () => api.get<TopicDto[]>(`/topics?subjectId=${plan.subjectId}&gradeId=${plan.gradeId}`),
    enabled: editable,
  });
  const invalidate = ["curriculum-plans", "topics"];
  const save = useSave(
    () =>
      api.put(`/curriculum-plans/${plan.id}`, {
        title,
        items: rows.map<PlanItemInput>((r) => ({
          topicTitle: r.topicTitle,
          hours: r.hours,
          lessonType: r.lessonType,
          periodId: r.periodId || null,
          homework: r.homework || null,
          objectives: r.objectives || null,
        })),
      }),
    invalidate,
    () => setDirty(false),
  );
  const submit = useSave(
    () => api.post(`/curriculum-plans/${plan.id}/submit`),
    invalidate,
    () => setSubmitting(false),
  );
  const approve = useSave(() => api.post(`/curriculum-plans/${plan.id}/approve`), invalidate);
  const newVersion = useSave(
    () =>
      api
        .post<CurriculumPlanDetailDto>(`/curriculum-plans/${plan.id}/new-version`)
        .then((p) => router.push(`${backHref}/${p.id}`)),
    invalidate,
  );
  const change = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const move = (index: number, by: number) => {
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row!);
      return next;
    });
    setDirty(true);
  };
  const totalHours = rows.reduce((sum, r) => sum + (r.hours || 0), 0);
  const topicListId = `topics-${plan.id}`;

  return (
    <>
      <PageHeader
        back={
          <Link
            href={backHref}
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("common.back")}
          </Link>
        }
        title={plan.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {`${plan.subjectName} · ${plan.gradeName}`}
            <PlanStatusBadge status={plan.status} />
            <span data-testid="plan-version">{t("plans.versionShort", { version: plan.version })}</span>
          </span>
        }
      />
      <div className="flex flex-col gap-4">
        {plan.status === "REJECTED" && plan.rejectionNote && (
          <Card className="border-danger p-4 text-sm" role="alert">
            <p className="font-medium text-danger">{t("plans.rejected")}</p>
            <p>{plan.rejectionNote}</p>
          </Card>
        )}
        <Card className="flex flex-wrap items-center gap-2 p-4">
          {plan.versions.length > 1 && (
            <span className="flex flex-wrap gap-1 text-sm">
              {plan.versions.map((v) => (
                <Link
                  key={v.id}
                  href={`${backHref}/${v.id}`}
                  className={v.id === plan.id ? "font-semibold" : "text-muted hover:text-foreground"}
                >
                  {t("plans.versionShort", { version: v.version })}
                </Link>
              ))}
            </span>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            {editable && (
              <Button
                variant="secondary"
                disabled={!dirty}
                loading={save.isPending}
                onClick={() => save.mutate(undefined)}
                data-testid="plan-save"
              >
                {t("common.save")}
              </Button>
            )}
            {editable && (
              <Button
                disabled={dirty || rows.length === 0}
                onClick={() => setSubmitting(true)}
                data-testid="plan-submit"
              >
                {t("plans.submit")}
              </Button>
            )}
            {approver && plan.status === "SUBMITTED" && (
              <>
                <Button
                  loading={approve.isPending}
                  onClick={() => approve.mutate(undefined)}
                  data-testid="plan-approve"
                >
                  {t("plans.approve")}
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(true)} data-testid="plan-reject">
                  {t("plans.reject")}
                </Button>
              </>
            )}
            {plan.canEdit && plan.status === "APPROVED" && (
              <Button
                variant="secondary"
                loading={newVersion.isPending}
                onClick={() => newVersion.mutate(undefined)}
                data-testid="plan-new-version"
              >
                {t("plans.newVersion")}
              </Button>
            )}
          </span>
        </Card>
        <Card>
          {editable && (
            <div className="border-b border-border p-4">
              <Field label={t("plans.planTitle")}>
                {(id) => (
                  <Input
                    id={id}
                    maxLength={200}
                    value={title}
                    onChange={(e) => (setTitle(e.target.value), setDirty(true))}
                  />
                )}
              </Field>
            </div>
          )}
          <datalist id={topicListId}>
            {(topics.data ?? []).map((tp) => (
              <option key={tp.id} value={tp.title} />
            ))}
          </datalist>
          {rows.length === 0 && <EmptyState text={t(editable ? "plans.noItemsEdit" : "plans.noItems")} />}
          <ol className="divide-y divide-border" data-testid="plan-items">
            {rows.map((r, i) => (
              <li key={r.key} className="grid gap-2 p-3 sm:grid-cols-[2rem_1fr_5rem_9rem_9rem_auto] sm:items-center">
                <span className="tabular text-sm text-muted">{i + 1}</span>
                {editable ? (
                  <>
                    <Input
                      aria-label={t("plans.topic")}
                      list={topicListId}
                      required
                      maxLength={300}
                      value={r.topicTitle}
                      onChange={(e) => change(r.key, { topicTitle: e.target.value })}
                      data-testid="item-topic"
                    />
                    <Input
                      aria-label={t("plans.hours")}
                      type="number"
                      min={1}
                      max={100}
                      value={r.hours}
                      onChange={(e) => change(r.key, { hours: Number(e.target.value) })}
                      data-testid="item-hours"
                    />
                    <Select
                      aria-label={t("plans.lessonType")}
                      value={r.lessonType}
                      onChange={(e) => change(r.key, { lessonType: e.target.value as LessonTypeCode })}
                    >
                      {LESSON_TYPES.map((lt) => (
                        <option key={lt} value={lt}>
                          {t(`plans.lessonTypes.${lt}`)}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={t("plans.period")}
                      value={r.periodId}
                      onChange={(e) => change(r.key, { periodId: e.target.value })}
                    >
                      <option value="">{t("plans.anyPeriod")}</option>
                      {(periods.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("plans.moveUp")}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("plans.moveDown")}
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("plans.removeItem")}
                        onClick={() => (setRows((rs) => rs.filter((x) => x.key !== r.key)), setDirty(true))}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </span>
                    <Input
                      className="sm:col-span-5 sm:col-start-2"
                      aria-label={t("plans.homework")}
                      placeholder={t("plans.homework")}
                      maxLength={2000}
                      value={r.homework}
                      onChange={(e) => change(r.key, { homework: e.target.value })}
                    />
                  </>
                ) : (
                  <>
                    <span className="font-medium">{r.topicTitle}</span>
                    <span className="tabular text-sm">{t("plans.hoursCount", { count: r.hours })}</span>
                    <span className="text-sm">{t(`plans.lessonTypes.${r.lessonType}`)}</span>
                    <span className="text-sm text-muted">
                      {periods.data?.find((p) => p.id === r.periodId)?.name ?? ""}
                    </span>
                    <span className="text-sm text-muted sm:col-span-5 sm:col-start-2">{r.homework}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4 text-sm">
            <span className="tabular" data-testid="plan-total">
              {t("plans.total", { items: rows.length, hours: totalHours })}
            </span>
            {editable && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setRows((rs) => [
                    ...rs,
                    {
                      key: ++rowKey,
                      topicTitle: "",
                      hours: 1,
                      lessonType: "NEW",
                      periodId: "",
                      homework: "",
                      objectives: "",
                    },
                  ]);
                  setDirty(true);
                }}
                data-testid="item-add"
              >
                <Plus className="size-4" aria-hidden />
                {t("plans.addItem")}
              </Button>
            )}
          </div>
        </Card>
        {plan.status === "APPROVED" && <AssignmentsCard plan={plan} />}
      </div>
      <ConfirmDialog
        open={submitting}
        title={t("plans.submit")}
        text={t("plans.submitConfirm")}
        loading={submit.isPending}
        onCancel={() => setSubmitting(false)}
        onConfirm={() => submit.mutate(undefined)}
      />
      {rejecting && <RejectDialog planId={plan.id} onClose={() => setRejecting(false)} />}
      {importing && (
        <ImportPlanDrawer
          plan={plan}
          onClose={() => setImporting(false)}
          onUploaded={(jobId) => router.push(`${backHref}/imports/${jobId}`)}
        />
      )}
    </>
  );
}

function RejectDialog({ planId, onClose }: { planId: string; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const [note, setNote] = useState("");
  const reject = useSave(
    (body: object) => api.post(`/curriculum-plans/${planId}/reject`, body),
    ["curriculum-plans"],
    onClose,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("plans.reject")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="reject-form"
            loading={reject.isPending}
            disabled={!note.trim()}
            data-testid="reject-confirm"
          >
            {t("plans.reject")}
          </Button>
        </>
      }
    >
      <form id="reject-form" onSubmit={(e: FormEvent) => (e.preventDefault(), reject.mutate({ note }))}>
        <Field label={t("plans.rejectNote")}>
          {(id) => (
            <textarea
              id={id}
              required
              maxLength={1000}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-button border border-border bg-surface p-2 text-sm"
              data-testid="reject-note"
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Excel (§4.2, §4.3)

function saveBlob({ blob, fileName }: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

type Mode = "ROWS" | "TOPICS";

/** Template download + upload of a filled file; `planId` makes the import a new version of that plan. */
function ImportPlanDrawer({
  plan,
  onClose,
  onUploaded,
}: {
  plan?: CurriculumPlanDetailDto;
  onClose: () => void;
  onUploaded: (jobId: string) => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const locale = useLocale();
  const targets = usePlanTargets();
  const [subjectId, setSubjectId] = useState(plan?.subjectId ?? "");
  const [gradeId, setGradeId] = useState(plan?.gradeId ?? "");
  const [mode, setMode] = useState<Mode>("TOPICS");
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const yearId = plan?.academicYearId ?? targets.year?.id ?? "";
  const groups = gradeId ? targets.classesOf(gradeId) : [];
  const options = {
    academicYearId: yearId,
    subjectId,
    gradeId,
    mode,
    ...(plan ? { planId: plan.id } : title ? { title } : {}),
    ...(groupId ? { teachingGroupId: groupId } : {}),
  };
  const template = useSave(
    () =>
      api
        .download(
          `/curriculum-plans/template?${new URLSearchParams({
            academicYearId: yearId,
            subjectId,
            gradeId,
            mode,
            locale: locale === "ru" ? "ru" : "uz",
            ...(groupId ? { teachingGroupId: groupId } : {}),
          })}`,
        )
        .then(saveBlob),
    [],
  );
  const upload = useSave(() => {
    const body = new FormData();
    body.set("options", JSON.stringify(options));
    body.set("file", file!);
    return api.post<ImportJobDto>("/curriculum-plans/import", body).then((job) => onUploaded(job.id));
  }, ["curriculum-plans"]);
  const ready = !!yearId && !!subjectId && !!gradeId && (mode === "TOPICS" || !!groupId);
  return (
    <FormDrawer
      title={plan ? t("plans.importVersion") : t("plans.importExcel")}
      formId="plan-import-form"
      busy={upload.isPending}
      saveLabel={t("imports.uploadAndCheck")}
      onClose={onClose}
    >
      <form
        id="plan-import-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), file && ready && upload.mutate(undefined))}
      >
        {!plan && (
          <>
            <Field label={t("structure.subject")}>
              {(id) => (
                <Select
                  id={id}
                  required
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  data-testid="import-subject"
                >
                  <option value="">—</option>
                  {targets.subjects.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("structure.level")}>
              {(id) => (
                <Select
                  id={id}
                  required
                  value={gradeId}
                  onChange={(e) => setGradeId(e.target.value)}
                  data-testid="import-grade"
                >
                  <option value="">—</option>
                  {targets.grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("plans.planTitle")}>
              {(id) => <Input id={id} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
          </>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("plans.importMode")}</legend>
          {(["TOPICS", "ROWS"] as const).map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                data-testid={`mode-${m}`}
              />
              <span>
                <span className="font-medium">{t(`plans.modes.${m}`)}</span>
                <span className="block text-xs text-muted">{t(`plans.modeHints.${m}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label={t("plans.group")} hint={t(mode === "ROWS" ? "plans.groupRowsHint" : "plans.groupTopicsHint")}>
          {(id, d) => (
            <Select
              id={id}
              aria-describedby={d}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              data-testid="import-group"
            >
              <option value="">—</option>
              {groups.map((c) => (
                <option key={c.id} value={c.classTeachingGroupId!}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          type="button"
          variant="secondary"
          disabled={!ready}
          loading={template.isPending}
          onClick={() => template.mutate(undefined)}
          data-testid="template-download"
        >
          <Download className="size-4" aria-hidden />
          {t("plans.downloadTemplate")}
        </Button>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("imports.file")}</span>
          <input
            type="file"
            accept=".xlsx"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="plan-file"
          />
        </label>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- applying to groups (§4.1, §4.4)

function AssignmentsCard({ plan }: { plan: CurriculumPlanDetailDto }) {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const targets = usePlanTargets();
  const assignments = useQuery({
    queryKey: ["plan-assignments", plan.id],
    queryFn: () => api.get<PlanAssignmentDto[]>(`/curriculum-plans/${plan.id}/assignments`),
  });
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reflowing, setReflowing] = useState<string | null>(null);
  const assign = useSave(
    () => api.post(`/curriculum-plans/${plan.id}/assignments`, { teachingGroupIds: chosen }),
    ["plan-assignments"],
    () => (setChoosing(false), setChosen([])),
  );
  const remove = useSave(
    (id: string) => api.delete(`/plan-assignments/${id}`),
    ["plan-assignments"],
    () => setRemoving(null),
  );
  const assigned = new Set((assignments.data ?? []).map((a) => a.teachingGroupId));
  const available = targets.classesOf(plan.gradeId).filter((c) => !assigned.has(c.classTeachingGroupId!));
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="font-semibold">{t("plans.groups")}</h2>
        {can(me.data, "curriculum.create") ? (
          <Button
            size="sm"
            disabled={available.length === 0}
            onClick={() => setChoosing(true)}
            data-testid="plan-assign"
          >
            {t("plans.assign")}
          </Button>
        ) : null}
      </div>
      <QueryBoundary
        query={assignments}
        isEmpty={(a) => a.length === 0}
        empty={<EmptyState text={t("plans.noGroups")} />}
      >
        {(rows) => (
          <ul className="divide-y divide-border" data-testid="plan-assignments">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <span className="font-medium">{a.teachingGroupName}</span>
                <span className="tabular text-muted">
                  {t("plans.placement", { placed: a.placed, lessons: a.lessons, hours: a.plannedHours })}
                </span>
                {a.warnings.length > 0 && (
                  <Badge tone="warning">
                    {t("plans.notPlaced", { count: a.warnings.reduce((n, w) => n + w.hours, 0) })}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setReflowing(a.id)}
                  data-testid="plan-reflow"
                >
                  {t("lessons.reflow")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(a.id)}>
                  {t("plans.unassign")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
      {choosing && (
        <Modal
          open
          onClose={() => setChoosing(false)}
          title={t("plans.assign")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setChoosing(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={chosen.length === 0}
                loading={assign.isPending}
                onClick={() => assign.mutate(undefined)}
                data-testid="assign-confirm"
              >
                {t("plans.assign")}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-muted">{t("plans.assignHint")}</p>
          <div className="flex flex-wrap gap-3">
            {available.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(c.classTeachingGroupId!)}
                  onChange={() =>
                    setChosen((ids) =>
                      ids.includes(c.classTeachingGroupId!)
                        ? ids.filter((x) => x !== c.classTeachingGroupId)
                        : [...ids, c.classTeachingGroupId!],
                    )
                  }
                  data-testid={`assign-${c.name}`}
                />
                {c.name}
              </label>
            ))}
          </div>
        </Modal>
      )}
      {reflowing && <ReflowDialog assignmentId={reflowing} onClose={() => setReflowing(null)} />}
      <ConfirmDialog
        open={!!removing}
        title={t("plans.unassign")}
        text={t("plans.unassignConfirm")}
        loading={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </Card>
  );
}

export function PlanImportDetail({ id, basePath }: { id: string; basePath: string }) {
  const t = useTranslations();
  const api = useApi();
  return (
    <ImportDetail
      id={id}
      backHref={basePath}
      committed={(job) => (
        <CreatedPlanLink jobId={job.id} basePath={basePath} api={api} label={t("plans.openCreated")} />
      )}
    />
  );
}

function CreatedPlanLink({
  jobId,
  basePath,
  api,
  label,
}: {
  jobId: string;
  basePath: string;
  api: ReturnType<typeof useApi>;
  label: string;
}) {
  const plan = useQuery({
    queryKey: ["curriculum-plans", "by-import", jobId],
    queryFn: () =>
      api
        .get<Page<CurriculumPlanSummaryDto>>(`/curriculum-plans?sourceImportId=${jobId}`)
        .then((p) => p.items[0] ?? null),
  });
  if (!plan.data) return null;
  return (
    <Card className="p-5">
      <Link
        href={`${basePath}/${plan.data.id}`}
        className="font-medium text-primary hover:underline"
        data-testid="import-open-plan"
      >
        {label}
      </Link>
    </Card>
  );
}
