"use client";

// Tests (tests.md §4.1, §6, §7): the list, creating a DRAFT, the editor (settings, questions by hand or a pool rule,
// what blocks publishing) and, once published, the results views (test-results.tsx).
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, Download, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type {
  AcademicPeriodDto,
  Page,
  QuestionDto,
  TeacherAssignmentDto,
  TestDetailDto,
  TestDto,
  TestSelection,
  TestTypeDto,
} from "@idrok/shared";
import { OFFLINE_MAX_SCORES } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useGrades, useSubjects } from "@/lib/queries";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { TestStatusBadge, formatInstant, fromLocalInput, saveBlob, toLocalInput, useTestTypeName } from "./common";
import { useTopics } from "./question-bank";
import { AttemptsTab, OfflineEntry, QuestionStatsTab, ResultsTab } from "./test-results";

export function useTestTypes() {
  const api = useApi();
  return useQuery({ queryKey: ["test-types"], queryFn: () => api.get<TestTypeDto[]>("/test-types") });
}

function useAssignments() {
  const api = useApi();
  const year = useActiveYear();
  return useQuery({
    queryKey: ["teacher-assignments", "tests", year.data?.id],
    queryFn: () =>
      api
        .get<Page<TeacherAssignmentDto>>(`/teacher-assignments?pageSize=100&academicYearId=${year.data!.id}`)
        .then((p) => p.items),
    enabled: !!year.data,
  });
}

function usePeriods() {
  const api = useApi();
  const year = useActiveYear();
  return useQuery({
    queryKey: ["periods", year.data?.id],
    queryFn: () => api.get<AcademicPeriodDto[]>(`/academic-years/${year.data!.id}/periods`),
    enabled: !!year.data,
  });
}

// ---------------------------------------------------------------- list

export function TestsListPage({ base }: { base: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const router = useRouter();
  const locale = useLocale();
  const me = useMe();
  const subjects = useSubjects();
  const typeName = useTestTypeName();
  const list = useListState(["status", "format", "subjectId"]);
  const tests = useQuery({
    queryKey: ["tests", list.apiQuery],
    queryFn: () => api.get<Page<TestDto>>(`/tests?${list.apiQuery}`),
  });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          can(me.data, "tests.create") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t("create")}
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput value={list.q} onChange={(q) => list.update({ q })} label={t("search")} />
          <FilterSelect
            label={t("subject")}
            allLabel={t("allSubjects")}
            value={list.filters.subjectId}
            onChange={(v) => list.update({ subjectId: v })}
            options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <FilterSelect
            label={t("statusLabel")}
            allLabel={t("allStatuses")}
            value={list.filters.status}
            onChange={(v) => list.update({ status: v })}
            options={(["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "ARCHIVED"] as const).map((s) => ({
              value: s,
              label: t(`status.${s}`),
            }))}
          />
          <FilterSelect
            label={t("format")}
            allLabel={t("allFormats")}
            value={list.filters.format}
            onChange={(v) => list.update({ format: v })}
            options={(["ONLINE", "OFFLINE"] as const).map((s) => ({ value: s, label: t(`formats.${s}`) }))}
          />
        </Toolbar>
        <QueryBoundary query={tests} isEmpty={(p) => p.items.length === 0} empty={<EmptyState text={t("empty")} />}>
          {(p) => (
            <>
              <DataTable
                testId="tests"
                rows={p.items}
                onRowClick={(x) => router.push(`${base}/${x.id}`)}
                columns={[
                  {
                    key: "title",
                    header: t("testTitle"),
                    primary: true,
                    cell: (x) => <span className="font-medium">{x.title}</span>,
                  },
                  { key: "subject", header: t("subject"), cell: (x) => `${x.subjectName} · ${x.gradeName}` },
                  {
                    key: "type",
                    header: t("type"),
                    cell: (x) => (
                      <span className="flex flex-wrap gap-1">
                        <Badge>{typeName({ code: x.testTypeCode, name: x.testTypeName })}</Badge>
                        <Badge tone={x.format === "ONLINE" ? "primary" : "neutral"}>{t(`formats.${x.format}`)}</Badge>
                        {x.purpose === "WEIGHTED" && <Badge tone="warning">{t("weighted")}</Badge>}
                      </span>
                    ),
                  },
                  {
                    key: "when",
                    header: t("when"),
                    cell: (x) =>
                      x.format === "OFFLINE"
                        ? (x.schoolDate ?? "—")
                        : x.startsAt || x.endsAt
                          ? `${formatInstant(x.startsAt, locale)} – ${formatInstant(x.endsAt, locale)}`
                          : "—",
                  },
                  { key: "status", header: t("statusLabel"), cell: (x) => <TestStatusBadge status={x.status} /> },
                  { key: "attempts", header: t("attemptsCount"), cell: (x) => x.attempts },
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
      {can(me.data, "test_types.manage") && <TestTypesCard />}
      {creating && (
        <CreateTestDrawer onClose={() => setCreating(false)} onCreated={(id) => router.push(`${base}/${id}`)} />
      )}
    </>
  );
}

function TestTypesCard() {
  const t = useTranslations("tests");
  const api = useApi();
  const types = useTestTypes();
  const typeName = useTestTypeName();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const add = useSave(
    () => api.post("/test-types", { name, code }),
    ["test-types"],
    () => (setName(""), setCode("")),
  );
  const toggle = useSave(
    (x: TestTypeDto) => api.patch(`/test-types/${x.id}`, { isActive: !x.isActive }),
    ["test-types"],
  );
  return (
    <Card className="mt-4">
      <CardHeader title={t("typesTitle")} />
      <QueryBoundary query={types}>
        {(list) => (
          <ul className="divide-y divide-border">
            {list.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  {typeName(x)} <span className="text-muted">{x.code}</span>
                </span>
                {!x.isSystem && (
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(x)}>
                    {x.isActive ? t("deactivate") : t("activate")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
      <form
        className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row"
        onSubmit={(e: FormEvent) => (e.preventDefault(), add.mutate(undefined))}
      >
        <Input
          aria-label={t("typeName")}
          placeholder={t("typeName")}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label={t("typeCode")}
          placeholder={t("typeCode")}
          required
          pattern="[A-Z0-9_]{2,30}"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button type="submit" loading={add.isPending}>
          {t("addType")}
        </Button>
      </form>
    </Card>
  );
}

function CreateTestDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations("tests");
  const api = useApi();
  const subjects = useSubjects();
  const grades = useGrades();
  const types = useTestTypes();
  const typeName = useTestTypeName();
  const assignments = useAssignments();
  const periods = usePeriods();
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [testTypeId, setTestTypeId] = useState("");
  const [format, setFormat] = useState<"ONLINE" | "OFFLINE">("ONLINE");
  const [purpose, setPurpose] = useState<"PRACTICE" | "WEIGHTED">("PRACTICE");
  const [periodId, setPeriodId] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const groupOptions = [
    ...new Map(
      (assignments.data ?? [])
        .filter((a) => !subjectId || a.subjectId === subjectId)
        .map((a) => [a.teachingGroupId, a.teachingGroupName]),
    ).entries(),
  ];
  const create = useSave(
    () =>
      api
        .post<TestDetailDto>("/tests", {
          title,
          subjectId,
          gradeId,
          testTypeId,
          format,
          purpose,
          ...(purpose === "WEIGHTED" ? { periodId, weight: "1" } : {}),
          ...(format === "OFFLINE" ? { maxScore: "20" } : {}),
          assignTo: { teachingGroupIds: groups },
        })
        .then((x) => onCreated(x.id)),
    ["tests"],
  );
  return (
    <FormDrawer title={t("create")} formId="test-create" busy={create.isPending} onClose={onClose}>
      <form
        id="test-create"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), create.mutate(undefined))}
      >
        <Field label={t("testTitle")}>
          {(id) => <Input id={id} required value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("subject")}>
            {(id) => (
              <Select
                id={id}
                required
                value={subjectId}
                onChange={(e) => (setSubjectId(e.target.value), setGroups([]))}
              >
                <option value="">{t("choose")}</option>
                {(subjects.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("grade")}>
            {(id) => (
              <Select id={id} required value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
                <option value="">{t("choose")}</option>
                {(grades.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("type")}>
            {(id) => (
              <Select id={id} required value={testTypeId} onChange={(e) => setTestTypeId(e.target.value)}>
                <option value="">{t("choose")}</option>
                {(types.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {typeName(x)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("format")}>
            {(id) => (
              <Select id={id} value={format} onChange={(e) => setFormat(e.target.value as "ONLINE" | "OFFLINE")}>
                <option value="ONLINE">{t("formats.ONLINE")}</option>
                <option value="OFFLINE">{t("formats.OFFLINE")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("purpose")} hint={t(`purposeHint.${purpose}`)}>
            {(id, hint) => (
              <Select
                id={id}
                aria-describedby={hint}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as "PRACTICE" | "WEIGHTED")}
              >
                <option value="PRACTICE">{t("purposes.PRACTICE")}</option>
                <option value="WEIGHTED">{t("purposes.WEIGHTED")}</option>
              </Select>
            )}
          </Field>
          {purpose === "WEIGHTED" && (
            <Field label={t("period")}>
              {(id) => (
                <Select id={id} required value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                  <option value="">{t("choose")}</option>
                  {(periods.data ?? [])
                    .filter((p) => p.status !== "CLOSED")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t("assignTo")}</legend>
          {groupOptions.length === 0 ? (
            <p className="text-sm text-muted">{t("noGroups")}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {groupOptions.map(([id, name]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={groups.includes(id)}
                    onChange={(e) => setGroups(e.target.checked ? [...groups, id] : groups.filter((g) => g !== id))}
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- editor / detail

type EditorTab = "settings" | "questions" | "results" | "analysis" | "attempts" | "entry";

export function TestDetailPage({ id, base }: { id: string; base: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const test = useQuery({ queryKey: ["test", id], queryFn: () => api.get<TestDetailDto>(`/tests/${id}`) });
  return (
    <QueryBoundary query={test}>
      {(x) => <TestDetailBody test={x} base={base} key={x.status} backLabel={t("back")} />}
    </QueryBoundary>
  );
}

function TestDetailBody({ test, base, backLabel }: { test: TestDetailDto; base: string; backLabel: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const router = useRouter();
  const locale = useLocale();
  const me = useMe();
  const typeName = useTestTypeName();
  const draft = test.status === "DRAFT";
  const tabs: { value: EditorTab; label: string }[] = draft
    ? [
        { value: "settings", label: t("tabs.settings") },
        ...(test.format === "ONLINE" ? [{ value: "questions" as const, label: t("tabs.questions") }] : []),
      ]
    : [
        { value: "results", label: t("tabs.results") },
        ...(test.format === "OFFLINE" ? [{ value: "entry" as const, label: t("tabs.entry") }] : []),
        ...(test.format === "ONLINE"
          ? [
              { value: "analysis" as const, label: t("tabs.analysis") },
              { value: "attempts" as const, label: t("tabs.attempts") },
            ]
          : []),
        { value: "settings", label: t("tabs.settings") },
      ];
  const [tab, setTab] = useState<EditorTab>(tabs[0]!.value);
  const [confirm, setConfirm] = useState<"publish" | "close" | "delete" | null>(null);
  const problems = useQuery({
    queryKey: ["test-problems", test.id],
    queryFn: () => api.get<{ problems: string[] }>(`/tests/${test.id}/problems`),
    enabled: draft && can(me.data, "tests.create"),
  });
  const act = useSave(
    async (what: "publish" | "close" | "delete") => {
      if (what === "delete") {
        await api.delete(`/tests/${test.id}`);
        router.push(base);
        return;
      }
      await api.post(`/tests/${test.id}/${what}`);
    },
    ["test", "tests", "test-problems"],
    () => setConfirm(null),
  );
  const exportResults = useSave(
    () => api.download(`/tests/${test.id}/results/export?locale=${locale === "ru" ? "ru" : "uz"}`).then(saveBlob),
    [],
  );
  const blocking = problems.data?.problems ?? [];
  return (
    <>
      <PageHeader
        back={
          <Link href={base} className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden />
            {backLabel}
          </Link>
        }
        title={test.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <TestStatusBadge status={test.status} />
            <span>{`${test.subjectName} · ${test.gradeName} · ${typeName({ code: test.testTypeCode, name: test.testTypeName })}`}</span>
            <Badge tone={test.format === "ONLINE" ? "primary" : "neutral"}>{t(`formats.${test.format}`)}</Badge>
            {test.purpose === "WEIGHTED" && (
              <Badge tone="warning">
                {t("weightedIn", { period: test.periodName ?? "", weight: test.weight ?? "" })}
              </Badge>
            )}
            {test.format === "ONLINE" && test.endsAt && (
              <span>{`${formatInstant(test.startsAt, locale)} – ${formatInstant(test.endsAt, locale)}`}</span>
            )}
          </span>
        }
        actions={
          <>
            {draft && can(me.data, "tests.publish") && (
              <Button disabled={blocking.length > 0} onClick={() => setConfirm("publish")} data-testid="publish">
                {t("publish")}
              </Button>
            )}
            {(test.status === "OPEN" || test.status === "SCHEDULED") && can(me.data, "tests.publish") && (
              <Button variant="secondary" onClick={() => setConfirm("close")}>
                {t("close")}
              </Button>
            )}
            {!draft && can(me.data, "tests.results.view") && (
              <Button
                variant="secondary"
                loading={exportResults.isPending}
                onClick={() => exportResults.mutate(undefined)}
              >
                <Download className="size-4" aria-hidden />
                {t("export")}
              </Button>
            )}
            {(draft || test.status === "CLOSED") && can(me.data, "tests.create") && (
              <Button variant="ghost" onClick={() => setConfirm("delete")}>
                <Trash2 className="size-4" aria-hidden />
                {draft ? t("delete") : t("archive")}
              </Button>
            )}
          </>
        }
      />
      {draft && blocking.length > 0 && (
        <div
          role="status"
          className="mb-4 rounded-card border border-warning bg-warning-soft p-3 text-sm text-warning"
          data-testid="test-problems"
        >
          <p className="font-medium">{t("notReady")}</p>
          <ul className="list-inside list-disc">
            {blocking.map((p) => (
              <li key={p}>{t(`problems.${p}`)}</li>
            ))}
          </ul>
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "settings" && <SettingsForm test={test} />}
      {tab === "questions" && <QuestionsEditor test={test} />}
      {tab === "results" && <ResultsTab test={test} />}
      {tab === "analysis" && <QuestionStatsTab testId={test.id} />}
      {tab === "attempts" && <AttemptsTab test={test} />}
      {tab === "entry" && <OfflineEntry test={test} />}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t(`confirm.${confirm}Title`) : ""}
        text={confirm ? t(`confirm.${confirm}Text`) : ""}
        danger={confirm === "delete"}
        loading={act.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </>
  );
}

function SettingsForm({ test }: { test: TestDetailDto }) {
  const t = useTranslations("tests");
  const api = useApi();
  const draft = test.status === "DRAFT";
  const locked = test.status === "CLOSED" || test.status === "ARCHIVED";
  const [v, setV] = useState({
    title: test.title,
    description: test.description ?? "",
    startsAt: toLocalInput(test.startsAt),
    endsAt: toLocalInput(test.endsAt),
    schoolDate: test.schoolDate ?? "",
    timeLimitMinutes: test.timeLimitMinutes ? String(test.timeLimitMinutes) : "",
    questionCount: test.questionCount ? String(test.questionCount) : "",
    shuffleQuestions: test.shuffleQuestions,
    shuffleOptions: test.shuffleOptions,
    multipleScoring: test.multipleScoring,
    violationThreshold: String(test.violationThreshold),
    showResultToStudent: test.showResultToStudent,
    retakePolicy: test.retakePolicy,
    includedInAssessment: test.includedInAssessment,
    maxScore: test.maxScore,
    weight: test.weight ?? "1",
    applyToRunning: false,
  });
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const online = test.format === "ONLINE";
  const save = useSave(
    () =>
      api.patch(
        `/tests/${test.id}`,
        draft
          ? {
              title: v.title,
              description: v.description || null,
              ...(online
                ? {
                    startsAt: fromLocalInput(v.startsAt),
                    endsAt: fromLocalInput(v.endsAt),
                    timeLimitMinutes: v.timeLimitMinutes ? Number(v.timeLimitMinutes) : null,
                    questionCount: v.questionCount ? Number(v.questionCount) : null,
                    shuffleQuestions: v.shuffleQuestions,
                    shuffleOptions: v.shuffleOptions,
                    multipleScoring: v.multipleScoring,
                    violationThreshold: Number(v.violationThreshold),
                    showResultToStudent: v.showResultToStudent,
                    retakePolicy: v.retakePolicy,
                  }
                : { schoolDate: v.schoolDate || null, maxScore: v.maxScore }),
              ...(test.purpose === "WEIGHTED"
                ? { weight: v.weight, includedInAssessment: v.includedInAssessment }
                : {}),
            }
          : {
              title: v.title,
              description: v.description || null,
              ...(online
                ? {
                    ...(test.status === "SCHEDULED" ? { startsAt: fromLocalInput(v.startsAt) } : {}),
                    endsAt: fromLocalInput(v.endsAt),
                    timeLimitMinutes: v.timeLimitMinutes ? Number(v.timeLimitMinutes) : null,
                    applyToRunning: v.applyToRunning,
                  }
                : {}),
            },
      ),
    ["test", "tests", "test-problems"],
  );
  const check = (
    label: string,
    key: "shuffleQuestions" | "shuffleOptions" | "includedInAssessment",
    disabled = !draft,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" disabled={disabled} checked={v[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <Card>
      <form
        className="grid gap-4 p-4 md:grid-cols-2"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <fieldset disabled={locked} className="contents">
          <Field label={t("testTitle")}>
            {(id) => <Input id={id} required value={v.title} onChange={(e) => set({ title: e.target.value })} />}
          </Field>
          <Field label={t("description")}>
            {(id) => <Input id={id} value={v.description} onChange={(e) => set({ description: e.target.value })} />}
          </Field>
          {online ? (
            <>
              <Field label={t("startsAt")} hint={t("startsAtHint")}>
                {(id, hint) => (
                  <Input
                    id={id}
                    aria-describedby={hint}
                    type="datetime-local"
                    disabled={!draft && test.status !== "SCHEDULED"}
                    value={v.startsAt}
                    onChange={(e) => set({ startsAt: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("endsAt")}>
                {(id) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    value={v.endsAt}
                    onChange={(e) => set({ endsAt: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("timeLimit")} hint={t("timeLimitHint")}>
                {(id, hint) => (
                  <Input
                    id={id}
                    aria-describedby={hint}
                    type="number"
                    min={1}
                    max={600}
                    value={v.timeLimitMinutes}
                    onChange={(e) => set({ timeLimitMinutes: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("questionCount")} hint={t("questionCountHint")}>
                {(id, hint) => (
                  <Input
                    id={id}
                    aria-describedby={hint}
                    type="number"
                    min={1}
                    disabled={!draft || test.selection.mode === "POOL"}
                    value={v.questionCount}
                    onChange={(e) => set({ questionCount: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("showResult")}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={!draft}
                    value={v.showResultToStudent}
                    onChange={(e) => set({ showResultToStudent: e.target.value as typeof v.showResultToStudent })}
                  >
                    {(["IMMEDIATE", "AFTER_CLOSE", "NEVER"] as const).map((x) => (
                      <option key={x} value={x}>
                        {t(`showResults.${x}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("violationThreshold")} hint={t("violationHint")}>
                {(id, hint) => (
                  <Input
                    id={id}
                    aria-describedby={hint}
                    type="number"
                    min={0}
                    max={20}
                    disabled={!draft}
                    value={v.violationThreshold}
                    onChange={(e) => set({ violationThreshold: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("multipleScoring")}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={!draft}
                    value={v.multipleScoring}
                    onChange={(e) => set({ multipleScoring: e.target.value as typeof v.multipleScoring })}
                  >
                    {(["ALL_OR_NOTHING", "PARTIAL"] as const).map((x) => (
                      <option key={x} value={x}>
                        {t(`multipleScorings.${x}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("retakePolicy")}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={!draft}
                    value={v.retakePolicy}
                    onChange={(e) => set({ retakePolicy: e.target.value as typeof v.retakePolicy })}
                  >
                    {(["LAST", "BEST"] as const).map((x) => (
                      <option key={x} value={x}>
                        {t(`retakes.${x}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="flex flex-col gap-2">
                {check(t("shuffleQuestions"), "shuffleQuestions")}
                {check(t("shuffleOptions"), "shuffleOptions")}
                {!draft && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={v.applyToRunning}
                      onChange={(e) => set({ applyToRunning: e.target.checked })}
                    />
                    {t("applyToRunning")}
                  </label>
                )}
              </div>
            </>
          ) : (
            <>
              <Field label={t("schoolDate")}>
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    disabled={!draft}
                    value={v.schoolDate}
                    onChange={(e) => set({ schoolDate: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("maxScore")}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={!draft}
                    value={v.maxScore}
                    onChange={(e) => set({ maxScore: e.target.value })}
                  >
                    {OFFLINE_MAX_SCORES.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          {test.purpose === "WEIGHTED" && (
            <>
              <Field label={t("weight")} hint={t("weightHint")}>
                {(id, hint) => (
                  <Input
                    id={id}
                    aria-describedby={hint}
                    inputMode="decimal"
                    disabled={!draft}
                    value={v.weight}
                    onChange={(e) => set({ weight: e.target.value })}
                  />
                )}
              </Field>
              {check(t("included"), "includedInAssessment")}
            </>
          )}
          <div className="md:col-span-2">
            <Button type="submit" loading={save.isPending}>
              {t("saveSettings")}
            </Button>
          </div>
        </fieldset>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- questions (DRAFT)

function QuestionsEditor({ test }: { test: TestDetailDto }) {
  const t = useTranslations("tests");
  const api = useApi();
  const [mode, setMode] = useState<TestSelection["mode"]>(test.selection.mode);
  const saveMode = useSave(
    (selection: TestSelection) => api.patch(`/tests/${test.id}`, { selection }),
    ["test", "test-problems"],
  );
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-2 text-sm font-medium">{t("selectionMode")}</legend>
          {(["MANUAL", "POOL"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  if (m === "MANUAL") saveMode.mutate({ mode: "MANUAL" });
                }}
              />
              {t(`modes.${m}`)}
            </label>
          ))}
        </fieldset>
      </Card>
      {mode === "MANUAL" ? (
        <ManualQuestions test={test} />
      ) : (
        <PoolRules test={test} onSave={(s) => saveMode.mutate(s)} busy={saveMode.isPending} />
      )}
    </div>
  );
}

function ManualQuestions({ test }: { test: TestDetailDto }) {
  const t = useTranslations("tests");
  const api = useApi();
  const [chosen, setChosen] = useState(
    test.questions.map((q) => ({ questionId: q.questionId, text: q.version.text, points: q.points, type: q.type })),
  );
  const [q, setQ] = useState("");
  const keyOf = (list: { questionId: string; points: string }[]) =>
    JSON.stringify(list.map((c) => [c.questionId, Number(c.points)]));
  const dirty = keyOf(chosen) !== keyOf(test.questions.map((x) => ({ questionId: x.questionId, points: x.points })));
  const groupId = test.assignments.find((a) => a.teachingGroupId)?.teachingGroupId;
  const bank = useQuery({
    queryKey: ["questions", "picker", test.subjectId, test.gradeId, q, groupId],
    queryFn: () =>
      api.get<Page<QuestionDto>>(
        `/question-bank/questions?${new URLSearchParams({
          subjectId: test.subjectId,
          gradeId: test.gradeId,
          pageSize: "100",
          ...(q ? { q } : {}),
          ...(groupId ? { teachingGroupId: groupId } : {}),
        })}`,
      ),
  });
  const save = useSave(
    () =>
      api.put(`/tests/${test.id}/questions`, {
        questions: chosen.map((c) => ({ questionId: c.questionId, points: c.points })),
      }),
    ["test", "test-problems"],
  );
  const move = (i: number, step: -1 | 1) => {
    const next = [...chosen];
    [next[i], next[i + step]] = [next[i + step]!, next[i]!];
    setChosen(next);
  };
  const total = chosen.reduce((n, c) => n + Number(c.points || 0), 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title={t("chosenQuestions", { n: chosen.length, points: total })}
          action={
            <Button
              size="sm"
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => save.mutate(undefined)}
              data-testid="save-questions"
            >
              {t("saveQuestions")}
            </Button>
          }
        />
        {chosen.length === 0 ? (
          <EmptyState text={t("noChosen")} />
        ) : (
          <ol className="divide-y divide-border" data-testid="chosen">
            {chosen.map((c, i) => (
              <li key={c.questionId} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className="w-6 text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{c.text}</span>
                <Input
                  aria-label={t("points")}
                  inputMode="decimal"
                  className="h-8 w-16"
                  value={c.points}
                  onChange={(e) => setChosen(chosen.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("moveUp")}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("moveDown")}
                  disabled={i === chosen.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("remove")}
                  onClick={() => setChosen(chosen.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card>
        <CardHeader title={t("fromBank")} />
        <Toolbar>
          <SearchInput value={q} onChange={setQ} label={t("bank.search")} />
        </Toolbar>
        <QueryBoundary
          query={bank}
          isEmpty={(p) => p.items.length === 0}
          empty={<EmptyState text={t("bank.emptyForTest")} />}
        >
          {(p) => (
            <ul className="divide-y divide-border" data-testid="bank-picker">
              {p.items.map((x) => {
                const taken = chosen.some((c) => c.questionId === x.id);
                return (
                  <li key={x.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2">{x.current.text}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge>{t(`questionType.${x.type}`)}</Badge>
                        {x.topicTitle && <Badge tone="primary">{x.topicTitle}</Badge>}
                        {x.usedWithGroup && <Badge tone="warning">{t("usedWithGroup")}</Badge>}
                        {!x.mine && <Badge>{x.ownerName}</Badge>}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant={taken ? "ghost" : "secondary"}
                      disabled={taken}
                      onClick={() =>
                        setChosen([
                          ...chosen,
                          { questionId: x.id, text: x.current.text, points: x.current.points, type: x.type },
                        ])
                      }
                    >
                      {taken ? t("added") : t("add")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryBoundary>
      </Card>
    </div>
  );
}

function PoolRules({ test, onSave, busy }: { test: TestDetailDto; onSave: (s: TestSelection) => void; busy: boolean }) {
  const t = useTranslations("tests");
  const topics = useTopics(test.subjectId, test.gradeId);
  const [rules, setRules] = useState(
    test.selection.mode === "POOL" ? test.selection.rules : [{ topicId: null, difficulty: null, count: 5 }],
  );
  const setRule = (i: number, patch: Partial<(typeof rules)[number]>) =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Card>
      <CardHeader title={t("poolTitle", { n: rules.reduce((n, r) => n + r.count, 0) })} />
      <p className="px-4 text-sm text-muted">{t("poolHint")}</p>
      <ul className="flex flex-col gap-2 p-4">
        {rules.map((r, i) => (
          <li key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_10rem_6rem_auto]">
            <Select
              aria-label={t("topic")}
              value={r.topicId ?? ""}
              onChange={(e) => setRule(i, { topicId: e.target.value || null })}
            >
              <option value="">{t("anyTopic")}</option>
              {(topics.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("difficulty")}
              value={r.difficulty ?? ""}
              onChange={(e) => setRule(i, { difficulty: (e.target.value || null) as typeof r.difficulty })}
            >
              <option value="">{t("anyDifficulty")}</option>
              {(["EASY", "MEDIUM", "HARD"] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`difficultyLevel.${x}`)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("count")}
              type="number"
              min={1}
              value={r.count}
              onChange={(e) => setRule(i, { count: Math.max(1, Number(e.target.value)) })}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("remove")}
              disabled={rules.length === 1}
              onClick={() => setRules(rules.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-border p-4">
        <Button variant="ghost" onClick={() => setRules([...rules, { topicId: null, difficulty: null, count: 1 }])}>
          <Plus className="size-4" aria-hidden />
          {t("addRule")}
        </Button>
        <Button loading={busy} onClick={() => onSave({ mode: "POOL", rules })}>
          {t("saveRules")}
        </Button>
      </div>
    </Card>
  );
}
