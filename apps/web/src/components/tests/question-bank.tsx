"use client";

// Question bank (tests.md §3): the teacher's own questions and the ones shared with their subject. Editing makes a new
// version (tests keep the version they were published with); only the owner edits.
import { useQuery } from "@tanstack/react-query";
import { Download, FileUp, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { ImportJobDto, Page, QuestionDifficultyCode, QuestionDto, QuestionTypeCode } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, SearchInput, Toolbar } from "@/components/ui/toolbar";
import { useGrades, useSubjects } from "@/lib/queries";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { AuthImage, saveBlob } from "./common";

const TYPES: QuestionTypeCode[] = ["SINGLE", "MULTIPLE", "SHORT_TEXT", "MATCHING"];
const DIFFICULTIES: QuestionDifficultyCode[] = ["EASY", "MEDIUM", "HARD"];
const DIFF_TONE = { EASY: "success", MEDIUM: "warning", HARD: "danger" } as const;

/** Topics of a subject and grade (for the topic pickers and filters). */
export function useTopics(subjectId: string, gradeId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["topics", subjectId, gradeId],
    queryFn: () =>
      api.get<{ id: string; title: string }[]>(`/topics?subjectId=${subjectId}&gradeId=${gradeId}`).catch(() => []),
    enabled: !!subjectId && !!gradeId,
  });
}

export function QuestionBankPage({ importsBase }: { importsBase: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const router = useRouter();
  const me = useMe();
  const subjects = useSubjects();
  const grades = useGrades();
  const list = useListState(["subjectId", "gradeId", "topicId", "type", "difficulty", "scope", "status"]);
  const f = list.filters;
  const topics = useTopics(f.subjectId, f.gradeId);
  const questions = useQuery({
    queryKey: ["questions", list.apiQuery],
    queryFn: () => api.get<Page<QuestionDto>>(`/question-bank/questions?${list.apiQuery}`),
  });
  const [editing, setEditing] = useState<QuestionDto | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const manage = can(me.data, "questions.manage");
  const exportAllowed = can(me.data, "questions.export") && !!f.subjectId;
  const doExport = useSave(
    () =>
      api
        .download(
          `/question-bank/export?${new URLSearchParams({ subjectId: f.subjectId, ...(f.gradeId ? { gradeId: f.gradeId } : {}) })}`,
        )
        .then(saveBlob),
    [],
  );
  return (
    <>
      <PageHeader
        title={t("bank.title")}
        subtitle={t("bank.subtitle")}
        actions={
          manage && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <FileUp className="size-4" aria-hidden />
                {t("bank.import")}
              </Button>
              {exportAllowed && (
                <Button variant="secondary" loading={doExport.isPending} onClick={() => doExport.mutate(undefined)}>
                  <Download className="size-4" aria-hidden />
                  {t("bank.export")}
                </Button>
              )}
              <Button onClick={() => setEditing("new")}>
                <Plus className="size-4" aria-hidden />
                {t("bank.add")}
              </Button>
            </>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput value={list.q} onChange={(q) => list.update({ q })} label={t("bank.search")} />
          <FilterSelect
            label={t("subject")}
            allLabel={t("allSubjects")}
            value={f.subjectId}
            onChange={(v) => list.update({ subjectId: v, topicId: "" })}
            options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <FilterSelect
            label={t("grade")}
            allLabel={t("allGrades")}
            value={f.gradeId}
            onChange={(v) => list.update({ gradeId: v, topicId: "" })}
            options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          />
          <FilterSelect
            label={t("topic")}
            allLabel={t("allTopics")}
            value={f.topicId}
            onChange={(v) => list.update({ topicId: v })}
            options={[
              { value: "none", label: t("bank.noTopic") },
              ...(topics.data ?? []).map((x) => ({ value: x.id, label: x.title })),
            ]}
          />
          <FilterSelect
            label={t("type")}
            allLabel={t("allTypes")}
            value={f.type}
            onChange={(v) => list.update({ type: v })}
            options={TYPES.map((x) => ({ value: x, label: t(`questionType.${x}`) }))}
          />
          <FilterSelect
            label={t("difficulty")}
            allLabel={t("allDifficulties")}
            value={f.difficulty}
            onChange={(v) => list.update({ difficulty: v })}
            options={DIFFICULTIES.map((x) => ({ value: x, label: t(`difficultyLevel.${x}`) }))}
          />
          <FilterSelect
            label={t("bank.scope")}
            allLabel={t("bank.scopeAll")}
            value={f.scope}
            onChange={(v) => list.update({ scope: v })}
            options={[
              { value: "mine", label: t("bank.scopeMine") },
              { value: "shared", label: t("bank.scopeShared") },
            ]}
          />
          <FilterSelect
            label={t("bank.status")}
            allLabel={t("bank.active")}
            value={f.status}
            onChange={(v) => list.update({ status: v })}
            options={[{ value: "ARCHIVED", label: t("bank.archived") }]}
          />
        </Toolbar>
        <QueryBoundary
          query={questions}
          isEmpty={(p) => p.items.length === 0}
          empty={<EmptyState text={t("bank.empty")} />}
        >
          {(p) => (
            <>
              <DataTable
                testId="questions"
                rows={p.items}
                onRowClick={(q) => setEditing(q)}
                columns={[
                  {
                    key: "text",
                    header: t("question"),
                    primary: true,
                    cell: (q) => <span className="line-clamp-2">{q.current.text}</span>,
                  },
                  { key: "type", header: t("type"), cell: (q) => t(`questionType.${q.type}`) },
                  {
                    key: "difficulty",
                    header: t("difficulty"),
                    cell: (q) => <Badge tone={DIFF_TONE[q.difficulty]}>{t(`difficultyLevel.${q.difficulty}`)}</Badge>,
                  },
                  {
                    key: "topic",
                    header: t("topic"),
                    cell: (q) => q.topicTitle ?? <span className="text-muted">—</span>,
                  },
                  {
                    key: "owner",
                    header: t("bank.owner"),
                    cell: (q) => (q.mine ? t("bank.mine") : <span className="text-muted">{q.ownerName}</span>),
                  },
                  {
                    key: "flags",
                    header: "",
                    cell: (q) => (
                      <span className="flex flex-wrap gap-1">
                        {q.sharedWithSubject && <Badge tone="primary">{t("bank.shared")}</Badge>}
                        {q.usedInTests > 0 && <Badge>{t("bank.usedIn", { n: q.usedInTests })}</Badge>}
                        {q.current.version > 1 && <Badge>{`v${q.current.version}`}</Badge>}
                      </span>
                    ),
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
      {editing && (
        <QuestionEditor
          question={editing === "new" ? null : editing}
          defaults={{ subjectId: f.subjectId, gradeId: f.gradeId }}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <ImportQuestionsDrawer
          defaults={{ subjectId: f.subjectId, gradeId: f.gradeId }}
          onClose={() => setImporting(false)}
          onUploaded={(id) => router.push(`${importsBase}/${id}`)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- editor

interface Draft {
  type: QuestionTypeCode;
  text: string;
  points: string;
  subjectId: string;
  gradeId: string;
  topicId: string;
  difficulty: QuestionDifficultyCode;
  sharedWithSubject: boolean;
  options: { id: string; text: string; isCorrect: boolean }[];
  acceptedAnswers: string[];
  pairs: { leftId: string; left: string; rightId: string; right: string }[];
  explanation: string;
  imageAssetId: string | null;
}

const letter = (i: number) => String.fromCharCode(97 + i);
const newOptions = () => [0, 1, 2, 3].map((i) => ({ id: letter(i), text: "", isCorrect: i === 0 }));
const newPairs = () => [1, 2].map((i) => ({ leftId: `l${i}`, left: "", rightId: `r${i}`, right: "" }));

function draftOf(q: QuestionDto | null, defaults: { subjectId: string; gradeId: string }): Draft {
  if (!q)
    return {
      type: "SINGLE",
      text: "",
      points: "1",
      subjectId: defaults.subjectId,
      gradeId: defaults.gradeId,
      topicId: "",
      difficulty: "MEDIUM",
      sharedWithSubject: false,
      options: newOptions(),
      acceptedAnswers: [""],
      pairs: newPairs(),
      explanation: "",
      imageAssetId: null,
    };
  return {
    type: q.type,
    text: q.current.text,
    points: q.current.points,
    subjectId: q.subjectId,
    gradeId: q.gradeId,
    topicId: q.topicId ?? "",
    difficulty: q.difficulty,
    sharedWithSubject: q.sharedWithSubject,
    options: q.current.options.length ? q.current.options : newOptions(),
    acceptedAnswers: q.current.acceptedAnswers?.length ? q.current.acceptedAnswers : [""],
    pairs: q.current.pairs?.length ? q.current.pairs : newPairs(),
    explanation: q.current.explanation ?? "",
    imageAssetId: q.current.imageAssetId,
  };
}

export function QuestionEditor({
  question,
  defaults,
  onClose,
}: {
  question: QuestionDto | null;
  defaults: { subjectId: string; gradeId: string };
  onClose: () => void;
}) {
  const t = useTranslations("tests");
  const api = useApi();
  const subjects = useSubjects();
  const grades = useGrades();
  const [d, setD] = useState<Draft>(() => draftOf(question, defaults));
  const topics = useTopics(d.subjectId, d.gradeId);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const readOnly = question !== null && !question.mine;
  const content = {
    text: d.text,
    points: d.points,
    options: d.type === "SINGLE" || d.type === "MULTIPLE" ? d.options : [],
    acceptedAnswers: d.type === "SHORT_TEXT" ? d.acceptedAnswers.filter((a) => a.trim()) : null,
    pairs: d.type === "MATCHING" ? d.pairs : null,
    explanation: d.explanation || null,
    imageAssetId: d.imageAssetId,
  };
  const save = useSave(
    () =>
      question
        ? api.patch(`/question-bank/questions/${question.id}`, {
            content,
            topicId: d.topicId || null,
            difficulty: d.difficulty,
            sharedWithSubject: d.sharedWithSubject,
          })
        : api.post("/question-bank/questions", {
            ...content,
            type: d.type,
            subjectId: d.subjectId,
            gradeId: d.gradeId,
            topicId: d.topicId || null,
            difficulty: d.difficulty,
            sharedWithSubject: d.sharedWithSubject,
          }),
    ["questions"],
    onClose,
  );
  const archive = useSave(
    () =>
      api.patch(`/question-bank/questions/${question!.id}`, {
        status: question!.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
      }),
    ["questions"],
    onClose,
  );
  const upload = useSave(async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    const { id } = await api.post<{ id: string }>("/question-bank/images", body);
    set({ imageAssetId: id });
  }, []);
  const setOption = (i: number, patch: Partial<Draft["options"][number]>) =>
    set({
      options: d.options.map((o, j) =>
        j === i ? { ...o, ...patch } : patch.isCorrect && d.type === "SINGLE" ? { ...o, isCorrect: false } : o,
      ),
    });
  return (
    <FormDrawer
      title={question ? (readOnly ? t("bank.view") : t("bank.edit")) : t("bank.add")}
      formId="question-form"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="question-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), !readOnly && save.mutate(undefined))}
      >
        <fieldset disabled={readOnly} className="flex flex-col gap-4">
          {question && question.usedInTests > 0 && !readOnly && (
            <p className="rounded-card bg-primary-soft p-3 text-sm text-primary-strong">{t("bank.versionNote")}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("subject")}>
              {(id) => (
                <Select
                  id={id}
                  required
                  disabled={!!question}
                  value={d.subjectId}
                  onChange={(e) => set({ subjectId: e.target.value, topicId: "" })}
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
                <Select
                  id={id}
                  required
                  disabled={!!question}
                  value={d.gradeId}
                  onChange={(e) => set({ gradeId: e.target.value, topicId: "" })}
                >
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
                <Select
                  id={id}
                  disabled={!!question}
                  value={d.type}
                  onChange={(e) => {
                    const type = e.target.value as QuestionTypeCode;
                    set({
                      type,
                      options: type === "SINGLE" ? d.options.map((o, i) => ({ ...o, isCorrect: i === 0 })) : d.options,
                    });
                  }}
                >
                  {TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`questionType.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("difficulty")}>
              {(id) => (
                <Select
                  id={id}
                  value={d.difficulty}
                  onChange={(e) => set({ difficulty: e.target.value as QuestionDifficultyCode })}
                >
                  {DIFFICULTIES.map((x) => (
                    <option key={x} value={x}>
                      {t(`difficultyLevel.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("topic")} hint={d.topicId ? undefined : t("bank.topicHint")}>
              {(id, hint) => (
                <Select
                  id={id}
                  aria-describedby={hint}
                  value={d.topicId}
                  onChange={(e) => set({ topicId: e.target.value })}
                >
                  <option value="">{t("bank.noTopic")}</option>
                  {(topics.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("points")}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  required
                  value={d.points}
                  onChange={(e) => set({ points: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label={t("question")}>
            {(id) => (
              <textarea
                id={id}
                required
                rows={3}
                value={d.text}
                onChange={(e) => set({ text: e.target.value })}
                className="w-full rounded-input border border-border bg-surface p-3 text-sm focus:border-primary focus:outline-none"
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            {d.imageAssetId && (
              <AuthImage
                path={`/question-bank/images/${d.imageAssetId}`}
                alt={t("bank.image")}
                className="max-h-32 rounded-card"
              />
            )}
            {!readOnly && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
                <Upload className="size-4" aria-hidden />
                {d.imageAssetId ? t("bank.replaceImage") : t("bank.addImage")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
                />
              </label>
            )}
            {d.imageAssetId && !readOnly && (
              <Button size="sm" variant="ghost" onClick={() => set({ imageAssetId: null })}>
                {t("bank.removeImage")}
              </Button>
            )}
          </div>

          {(d.type === "SINGLE" || d.type === "MULTIPLE") && (
            <fieldset className="flex flex-col gap-2" data-testid="options">
              <legend className="mb-1 text-sm font-medium">
                {d.type === "SINGLE" ? t("bank.optionsSingle") : t("bank.optionsMultiple")}
              </legend>
              {d.options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input
                    type={d.type === "SINGLE" ? "radio" : "checkbox"}
                    name="correct"
                    aria-label={t("bank.correctOption", { letter: o.id.toUpperCase() })}
                    checked={o.isCorrect}
                    onChange={(e) => setOption(i, { isCorrect: e.target.checked })}
                  />
                  <span className="w-5 text-sm font-semibold text-muted">{o.id.toUpperCase()}</span>
                  <Input
                    aria-label={t("bank.optionText", { letter: o.id.toUpperCase() })}
                    required
                    value={o.text}
                    onChange={(e) => setOption(i, { text: e.target.value })}
                  />
                  {d.options.length > 2 && !readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("remove")}
                      onClick={() => set({ options: d.options.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              {d.options.length < 6 && !readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => {
                    const used = new Set(d.options.map((o) => o.id));
                    const id = [0, 1, 2, 3, 4, 5].map(letter).find((x) => !used.has(x))!;
                    set({ options: [...d.options, { id, text: "", isCorrect: false }] });
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("bank.addOption")}
                </Button>
              )}
            </fieldset>
          )}

          {d.type === "SHORT_TEXT" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("bank.accepted")}</legend>
              <p className="text-xs text-muted">{t("bank.acceptedHint")}</p>
              {d.acceptedAnswers.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={t("bank.accepted")}
                    value={a}
                    onChange={(e) =>
                      set({ acceptedAnswers: d.acceptedAnswers.map((x, j) => (j === i ? e.target.value : x)) })
                    }
                  />
                  {d.acceptedAnswers.length > 1 && !readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("remove")}
                      onClick={() => set({ acceptedAnswers: d.acceptedAnswers.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => set({ acceptedAnswers: [...d.acceptedAnswers, ""] })}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("bank.addAccepted")}
                </Button>
              )}
            </fieldset>
          )}

          {d.type === "MATCHING" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("bank.pairs")}</legend>
              {d.pairs.map((p, i) => (
                <div key={p.leftId} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input
                    aria-label={t("bank.left")}
                    placeholder={t("bank.left")}
                    required
                    value={p.left}
                    onChange={(e) =>
                      set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)) })
                    }
                  />
                  <Input
                    aria-label={t("bank.right")}
                    placeholder={t("bank.right")}
                    required
                    value={p.right}
                    onChange={(e) =>
                      set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)) })
                    }
                  />
                  {d.pairs.length > 2 && !readOnly ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("remove")}
                      onClick={() => set({ pairs: d.pairs.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              {d.pairs.length < 10 && !readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => {
                    const n = Math.max(0, ...d.pairs.map((p) => Number(p.leftId.slice(1)) || 0)) + 1;
                    set({ pairs: [...d.pairs, { leftId: `l${n}`, left: "", rightId: `r${n}`, right: "" }] });
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("bank.addPair")}
                </Button>
              )}
            </fieldset>
          )}

          <Field label={t("bank.explanation")}>
            {(id) => <Input id={id} value={d.explanation} onChange={(e) => set({ explanation: e.target.value })} />}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={d.sharedWithSubject}
              onChange={(e) => set({ sharedWithSubject: e.target.checked })}
            />
            {t("bank.shareWithSubject")}
          </label>
        </fieldset>
        {question && question.mine && (
          <Button
            variant="ghost"
            className="self-start"
            loading={archive.isPending}
            onClick={() => archive.mutate(undefined)}
          >
            {question.status === "ACTIVE" ? t("bank.archive") : t("bank.restore")}
          </Button>
        )}
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- import

function ImportQuestionsDrawer({
  defaults,
  onClose,
  onUploaded,
}: {
  defaults: { subjectId: string; gradeId: string };
  onClose: () => void;
  onUploaded: (jobId: string) => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const locale = useLocale();
  const subjects = useSubjects();
  const grades = useGrades();
  const [subjectId, setSubjectId] = useState(defaults.subjectId);
  const [gradeId, setGradeId] = useState(defaults.gradeId);
  const [shared, setShared] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const template = useSave(
    () => api.download(`/question-bank/template?locale=${locale === "ru" ? "ru" : "uz"}`).then(saveBlob),
    [],
  );
  const upload = useSave(() => {
    const body = new FormData();
    body.set("options", JSON.stringify({ subjectId, gradeId, sharedWithSubject: shared }));
    body.set("file", file!);
    return api.post<ImportJobDto>("/question-bank/import", body).then((job) => onUploaded(job.id));
  }, ["questions"]);
  return (
    <FormDrawer
      title={t("tests.bank.import")}
      formId="question-import"
      busy={upload.isPending}
      saveLabel={t("imports.uploadAndCheck")}
      onClose={onClose}
    >
      <form
        id="question-import"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), file && subjectId && gradeId && upload.mutate(undefined))}
      >
        <p className="text-sm text-muted">{t("tests.bank.importHint")}</p>
        <Button
          variant="secondary"
          className="self-start"
          loading={template.isPending}
          onClick={() => template.mutate(undefined)}
        >
          <Download className="size-4" aria-hidden />
          {t("imports.downloadTemplate")}
        </Button>
        <Field label={t("tests.subject")}>
          {(id) => (
            <Select id={id} required value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">{t("tests.choose")}</option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("tests.grade")}>
          {(id) => (
            <Select id={id} required value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              <option value="">{t("tests.choose")}</option>
              {(grades.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {t("tests.bank.shareWithSubject")}
        </label>
        <Field label={t("imports.file")} hint={t("imports.fileHint")}>
          {(id, hint) => (
            <Input
              id={id}
              aria-describedby={hint}
              type="file"
              required
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="h-auto py-2"
            />
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}
