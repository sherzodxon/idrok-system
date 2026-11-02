"use client";

// Admin side of M3 (scoring.md §9): the policy editor (live sum check), limits / criteria / settings, grade scales,
// the period closing wizard and the "who has not scored" report.
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type {
  AcademicPeriodDto,
  AssessmentConfig,
  AssessmentPolicyDto,
  GradeBand,
  GradeScaleDto,
  Page,
  PeriodCloseRunDto,
  PolicyBindingDto,
  PolicyComponent,
  PolicyVersionDto,
  ScoreCriterionDto,
  ScoreLimitRuleDto,
  ScoreSettingsDto,
  TeacherAssignmentDto,
} from "@idrok/shared";
import { addSchoolDays, schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { PageHeader, Tabs, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useEmployees, useGrades, useSubjects } from "@/lib/queries";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";

type Tab = "policy" | "limits" | "scales" | "closing" | "missing";

export function AssessmentAdminPage() {
  const t = useTranslations("assessment");
  const me = useMe();
  const [tab, setTab] = useState<Tab>("policy");
  const tabs: { value: Tab; label: string }[] = [
    { value: "policy", label: t("tabs.policy") },
    { value: "limits", label: t("tabs.limits") },
    { value: "scales", label: t("tabs.scales") },
    ...(can(me.data, "assessment.approve") ? [{ value: "closing" as const, label: t("tabs.closing") }] : []),
    { value: "missing", label: t("tabs.missing") },
  ];
  const manage = can(me.data, "assessment.manage");
  return (
    <>
      <PageHeader title={t("title")} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "policy" && <PolicyTab manage={manage} />}
      {tab === "limits" && <LimitsTab manage={manage} />}
      {tab === "scales" && <ScalesTab manage={manage} />}
      {tab === "closing" && <ClosingTab />}
      {tab === "missing" && <MissingTab />}
    </>
  );
}

// ---------------------------------------------------------------- policy editor

function RadioRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  render,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  disabled?: boolean;
  render: (v: T) => string;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {render(o)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function PolicyTab({ manage }: { manage: boolean }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const policies = useQuery({
    queryKey: ["assessment-policies"],
    queryFn: () => api.get<AssessmentPolicyDto[]>("/assessment/policies"),
  });
  const [versionId, setVersionId] = useState("");
  return (
    <QueryBoundary query={policies} isEmpty={(p) => p.length === 0}>
      {(list) => {
        const all = list.flatMap((p) => p.versions.map((v) => ({ ...v, policy: p })));
        const chosen =
          all.find((v) => v.id === versionId) ??
          all.find((v) => v.policy.isDefault && v.status === "PUBLISHED") ??
          all[0]!;
        return (
          <div className="flex flex-col gap-4">
            <Card>
              <Toolbar>
                <Select
                  aria-label={t("version")}
                  value={chosen.id}
                  onChange={(e) => setVersionId(e.target.value)}
                  className="sm:w-96"
                >
                  {all.map((v) => (
                    <option key={v.id} value={v.id}>
                      {`${v.policy.name} · v${v.version} · ${t(`versionStatus.${v.status}`)}${v.policy.isDefault ? ` · ${t("default")}` : ""}`}
                    </option>
                  ))}
                </Select>
                {manage && <NewPolicyButton onCreated={setVersionId} />}
              </Toolbar>
            </Card>
            <VersionEditor
              key={chosen.id}
              versionId={chosen.id}
              policy={chosen.policy}
              manage={manage}
              onSaved={setVersionId}
            />
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function NewPolicyButton({ onCreated }: { onCreated: (versionId: string) => void }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const [name, setName] = useState("");
  const save = useSave(
    () => api.post<PolicyVersionDto>("/assessment/policies", { name: name.trim() }).then((v) => onCreated(v.id)),
    ["assessment-policies"],
    () => setName(""),
  );
  return (
    <span className="flex gap-2">
      <Input
        aria-label={t("newPolicyName")}
        placeholder={t("newPolicyName")}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        variant="secondary"
        disabled={!name.trim()}
        loading={save.isPending}
        onClick={() => save.mutate(undefined)}
      >
        <Plus className="size-4" aria-hidden />
        {t("newPolicy")}
      </Button>
    </span>
  );
}

function VersionEditor({
  versionId,
  policy,
  manage,
  onSaved,
}: {
  versionId: string;
  policy: AssessmentPolicyDto;
  manage: boolean;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("assessment");
  const api = useApi();
  const version = useQuery({
    queryKey: ["assessment-version", versionId],
    queryFn: () => api.get<PolicyVersionDto>(`/assessment/versions/${versionId}`),
  });
  const scales = useQuery({ queryKey: ["grade-scales"], queryFn: () => api.get<GradeScaleDto[]>("/grade-scales") });
  const [config, setConfig] = useState<AssessmentConfig | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const current = config ?? version.data?.config ?? null;
  const editable = manage && version.data?.status === "DRAFT";

  // Live check while editing (§9: the component sum is checked as you type).
  useEffect(() => {
    if (!current || !manage) return;
    const timer = setTimeout(() => {
      api
        .post<{ problems: string[] }>("/assessment/validate", current)
        .then((r) => setProblems(r.problems))
        .catch(() => setProblems(["INVALID"]));
    }, 300);
    return () => clearTimeout(timer);
  }, [api, current, manage]);

  const saveDraft = useSave(
    () =>
      api.put<PolicyVersionDto>(`/assessment/policies/${policy.id}/draft`, { config: current }).then((v) => {
        setConfig(null);
        onSaved(v.id);
      }),
    ["assessment-policies", "assessment-version"],
  );
  const publish = useSave(
    () => api.post(`/assessment/versions/${versionId}/publish`),
    ["assessment-policies", "assessment-version"],
  );
  const makeDefault = useSave(() => api.post(`/assessment/policies/${policy.id}/default`), ["assessment-policies"]);

  return (
    <QueryBoundary query={version}>
      {(v) => {
        const c = current ?? v.config;
        const set = (patch: Partial<AssessmentConfig>) => setConfig({ ...c, ...patch });
        const setComponent = (i: number, patch: Partial<PolicyComponent>) =>
          set({ components: c.components.map((x, j) => (i === j ? { ...x, ...patch } : x)) });
        const sum = c.components.filter((x) => x.enabled).reduce((n, x) => n + Number(x.maxPoints || 0), 0);
        const disabled = !editable;
        return (
          <Card>
            <CardHeader
              title={`${policy.name} · v${v.version}`}
              action={
                <Badge tone={v.status === "PUBLISHED" ? "success" : v.status === "DRAFT" ? "warning" : "neutral"}>
                  {t(`versionStatus.${v.status}`)}
                </Badge>
              }
            />
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <RadioRow
                label={t("f.dailyView")}
                value={c.dailyView}
                options={["BY_SUBJECT", "OVERALL", "BOTH"] as const}
                onChange={(x) => set({ dailyView: x })}
                disabled={disabled}
                render={(x) => t(`o.dailyView.${x}`)}
              />
              <RadioRow
                label={t("f.overallMethod")}
                value={c.overallMethod}
                options={["POOLED", "WEIGHTED_SUBJECTS"] as const}
                onChange={(x) => set({ overallMethod: x })}
                disabled={disabled}
                render={(x) => t(`o.overallMethod.${x}`)}
              />
              <RadioRow
                label={t("f.absentExcused")}
                value={c.absentExcused}
                options={["EXCLUDE", "ZERO"] as const}
                onChange={(x) => set({ absentExcused: x })}
                disabled={disabled}
                render={(x) => t(`o.excludeZero.${x}`)}
              />
              <RadioRow
                label={t("f.absentUnexcused")}
                value={c.absentUnexcused}
                options={["EXCLUDE", "ZERO"] as const}
                onChange={(x) => set({ absentUnexcused: x })}
                disabled={disabled}
                render={(x) => t(`o.excludeZero.${x}`)}
              />
              <RadioRow
                label={t("f.ungradedPresentAs")}
                value={c.ungradedPresentAs}
                options={["PENDING", "ZERO"] as const}
                onChange={(x) => set({ ungradedPresentAs: x })}
                disabled={disabled}
                render={(x) => t(`o.ungraded.${x}`)}
              />
              <RadioRow
                label={t("f.emptyComponent")}
                value={c.emptyComponent}
                options={["REDISTRIBUTE", "ZERO", "PENDING"] as const}
                onChange={(x) => set({ emptyComponent: x })}
                disabled={disabled}
                render={(x) => t(`o.emptyComponent.${x}`)}
              />
              <RadioRow
                label={t("f.testsMode")}
                value={c.testsMode}
                options={["COMBINED", "SEPARATE", "SELECTIVE"] as const}
                onChange={(x) => set({ testsMode: x })}
                disabled={disabled}
                render={(x) => t(`o.testsMode.${x}`)}
              />
              <RadioRow
                label={t("f.missedTest")}
                value={c.missedTest}
                options={["EXCLUDE", "ZERO"] as const}
                onChange={(x) => set({ missedTest: x })}
                disabled={disabled}
                render={(x) => t(`o.excludeZero.${x}`)}
              />
              <RadioRow
                label={t("f.retakePolicy")}
                value={c.retakePolicy}
                options={["LAST", "BEST"] as const}
                onChange={(x) => set({ retakePolicy: x })}
                disabled={disabled}
                render={(x) => t(`o.retake.${x}`)}
              />
              <RadioRow
                label={t("f.higherDefault")}
                value={c.higherDefault.aggregation}
                options={["AVERAGE", "INDEPENDENT"] as const}
                onChange={(x) => set({ higherDefault: { aggregation: x } })}
                disabled={disabled}
                render={(x) => t(`o.aggregation.${x}`)}
              />
              <RadioRow
                label={t("f.rounding")}
                value={c.rounding.mode}
                options={["HALF_UP", "FLOOR", "CEIL"] as const}
                onChange={(x) => set({ rounding: { ...c.rounding, mode: x } })}
                disabled={disabled}
                render={(x) => t(`o.rounding.${x}`)}
              />
              <RadioRow
                label={t("f.decimals")}
                value={String(c.rounding.decimals) as "0" | "1" | "2"}
                options={["0", "1", "2"] as const}
                onChange={(x) => set({ rounding: { ...c.rounding, decimals: Number(x) } })}
                disabled={disabled}
                render={(x) => x}
              />
              <Field label={t("f.gradeScale")}>
                {(id) => (
                  <Select
                    id={id}
                    value={c.gradeScaleId ?? ""}
                    disabled={disabled}
                    onChange={(e) => set({ gradeScaleId: e.target.value || null })}
                  >
                    <option value="">{t("noScale")}</option>
                    {(scales.data ?? [])
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label={t("f.periodMaxPoints")}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={c.periodMaxPoints}
                    disabled={disabled}
                    onChange={(e) => set({ periodMaxPoints: e.target.value })}
                  />
                )}
              </Field>
              <fieldset className="md:col-span-2">
                <legend className="mb-1 text-sm font-medium">{t("f.enabledViews")}</legend>
                <div className="flex flex-wrap gap-4">
                  {(["DAY", "WEEK", "MONTH", "PERIOD"] as const).map((view) => (
                    <label key={view} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={c.enabledViews.includes(view)}
                        onChange={(e) =>
                          set({
                            enabledViews: e.target.checked
                              ? [...c.enabledViews, view]
                              : c.enabledViews.filter((x) => x !== view),
                          })
                        }
                      />
                      {t(`views.${view}`)}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={c.overallPeriodResult}
                      onChange={(e) => set({ overallPeriodResult: e.target.checked })}
                    />
                    {t("f.overallPeriodResult")}
                  </label>
                </div>
              </fieldset>
            </div>
            <div className="border-t border-border p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">{t("components")}</h3>
                <span
                  className={
                    sum === Number(c.periodMaxPoints) ? "tabular text-sm text-success" : "tabular text-sm text-danger"
                  }
                  data-testid="components-sum"
                >
                  {t("componentsSum", { sum, max: c.periodMaxPoints })}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {c.components.map((comp, i) => (
                  <li key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_8rem_6rem_auto] sm:items-center">
                    <Input
                      aria-label={t("componentName")}
                      value={comp.name}
                      disabled={disabled}
                      onChange={(e) => setComponent(i, { name: e.target.value })}
                    />
                    <Select
                      aria-label={t("componentType")}
                      value={comp.type}
                      disabled={disabled}
                      onChange={(e) => setComponent(i, { type: e.target.value as PolicyComponent["type"] })}
                    >
                      {(["DAILY_SCORES", "TESTS", "MANUAL"] as const).map((x) => (
                        <option key={x} value={x}>
                          {t(`o.componentType.${x}`)}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={t("componentKey")}
                      value={comp.key}
                      disabled={disabled}
                      onChange={(e) => setComponent(i, { key: e.target.value })}
                    />
                    <Input
                      aria-label={t("componentMax")}
                      inputMode="decimal"
                      value={comp.maxPoints}
                      disabled={disabled}
                      onChange={(e) => setComponent(i, { maxPoints: e.target.value })}
                    />
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={t("componentEnabled")}
                        disabled={disabled}
                        checked={comp.enabled}
                        onChange={(e) => setComponent(i, { enabled: e.target.checked })}
                      />
                      {!disabled && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("remove")}
                          onClick={() => set({ components: c.components.filter((_, j) => j !== i) })}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {!disabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() =>
                    set({
                      components: [
                        ...c.components,
                        {
                          key: `manual${c.components.length + 1}`,
                          type: "MANUAL",
                          name: t("manual"),
                          maxPoints: "0",
                          enabled: true,
                        },
                      ],
                    })
                  }
                >
                  <Plus className="size-4" aria-hidden />
                  {t("addComponent")}
                </Button>
              )}
            </div>
            {manage && problems.length > 0 && (
              <ul
                role="status"
                className="mx-4 mb-4 rounded-card border border-danger bg-danger-soft p-3 text-sm text-danger"
                data-testid="policy-problems"
              >
                {problems.map((p) => (
                  <li key={p}>{t.has(`problems.${p}`) ? t(`problems.${p}`) : p}</li>
                ))}
              </ul>
            )}
            {manage && (
              <div className="flex flex-wrap gap-2 border-t border-border p-4">
                {v.status === "DRAFT" ? (
                  <>
                    <Button
                      variant="secondary"
                      loading={saveDraft.isPending}
                      disabled={!config}
                      onClick={() => saveDraft.mutate(undefined)}
                    >
                      {t("saveDraft")}
                    </Button>
                    <Button
                      loading={publish.isPending}
                      disabled={!!config || problems.length > 0}
                      onClick={() => publish.mutate(undefined)}
                    >
                      {t("publish")}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" loading={saveDraft.isPending} onClick={() => saveDraft.mutate(undefined)}>
                    {t("newVersion")}
                  </Button>
                )}
                {v.status === "PUBLISHED" && !policy.isDefault && (
                  <Button variant="ghost" loading={makeDefault.isPending} onClick={() => makeDefault.mutate(undefined)}>
                    {t("makeDefault")}
                  </Button>
                )}
              </div>
            )}
          </Card>
        );
      }}
    </QueryBoundary>
  );
}

// ---------------------------------------------------------------- limits, criteria, settings

function LimitsTab({ manage }: { manage: boolean }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const settings = useQuery({
    queryKey: ["score-settings"],
    queryFn: () => api.get<ScoreSettingsDto>("/score-settings"),
  });
  const rules = useQuery({
    queryKey: ["score-limit-rules"],
    queryFn: () => api.get<ScoreLimitRuleDto[]>("/score-limit-rules"),
  });
  const criteria = useQuery({
    queryKey: ["score-criteria"],
    queryFn: () => api.get<ScoreCriterionDto[]>("/score-criteria"),
  });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t("settings")} />
        <QueryBoundary query={settings}>{(s) => <SettingsForm initial={s} manage={manage} />}</QueryBoundary>
      </Card>
      <Card>
        <CardHeader title={t("rules")} />
        {manage && <NewRuleForm />}
        <QueryBoundary query={rules} isEmpty={(r) => r.length === 0} empty={<EmptyState text={t("noRules")} />}>
          {(list) => (
            <ul className="divide-y divide-border" data-testid="rules">
              {list.map((r) => (
                <RuleRow key={r.id} rule={r} manage={manage} />
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>
      <Card>
        <CardHeader title={t("criteria")} />
        {manage && <NewCriterionForm />}
        <QueryBoundary query={criteria} isEmpty={(c) => c.length === 0} empty={<EmptyState text={t("noCriteria")} />}>
          {(list) => (
            <ul className="divide-y divide-border">
              {list.map((c) => (
                <CriterionRow key={c.id} criterion={c} manage={manage} />
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>
    </div>
  );
}

function SettingsForm({ initial, manage }: { initial: ScoreSettingsDto; manage: boolean }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const [s, setS] = useState(initial);
  const save = useSave(() => api.put("/score-settings", s), ["score-settings"]);
  const num = (key: "hardCapPerLesson" | "hardCapPerDay" | "lessonMaxPoints") => (
    <Field label={t(`s.${key}`)}>
      {(id) => (
        <Input
          id={id}
          inputMode="decimal"
          value={s[key]}
          disabled={!manage}
          onChange={(e) => setS({ ...s, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <form className="grid gap-4 p-4 md:grid-cols-3" onSubmit={(e) => (e.preventDefault(), save.mutate(undefined))}>
      {num("lessonMaxPoints")}
      {num("hardCapPerLesson")}
      {num("hardCapPerDay")}
      <Field label={t("s.lateEntryDays")}>
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            value={String(s.lateEntryDays)}
            disabled={!manage}
            onChange={(e) => setS({ ...s, lateEntryDays: Number(e.target.value) || 0 })}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input
          type="checkbox"
          disabled={!manage}
          checked={s.allowScoreOnAbsent}
          onChange={(e) => setS({ ...s, allowScoreOnAbsent: e.target.checked })}
        />
        {t("s.allowScoreOnAbsent")}
      </label>
      {manage && (
        <div className="md:col-span-3">
          <Button type="submit" loading={save.isPending}>
            {t("save")}
          </Button>
        </div>
      )}
    </form>
  );
}

const WINDOWS = ["LESSON", "DAY", "WEEK", "MONTH", "PERIOD"] as const;
const SCOPES = ["GLOBAL", "SUBJECT", "GRADE", "TEACHER", "TEACHING_GROUP"] as const;

function NewRuleForm() {
  const t = useTranslations("assessment");
  const api = useApi();
  const year = useActiveYear();
  const subjects = useSubjects();
  const grades = useGrades();
  const employees = useEmployees();
  const groups = useQuery({
    queryKey: ["teacher-assignments", "groups", year.data?.id],
    queryFn: () =>
      api
        .get<Page<TeacherAssignmentDto>>(`/teacher-assignments?pageSize=100&academicYearId=${year.data!.id}`)
        .then((p) => p.items),
    enabled: !!year.data,
  });
  const [rule, setRule] = useState({
    window: "DAY" as (typeof WINDOWS)[number],
    scopeType: "GLOBAL" as (typeof SCOPES)[number],
    scopeId: "",
    maxPoints: "",
  });
  const scopeOptions =
    rule.scopeType === "SUBJECT"
      ? (subjects.data ?? []).map((s) => ({ id: s.id, name: s.name }))
      : rule.scopeType === "GRADE"
        ? (grades.data ?? []).map((g) => ({ id: g.id, name: g.name }))
        : rule.scopeType === "TEACHER"
          ? (employees.data ?? []).map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` }))
          : rule.scopeType === "TEACHING_GROUP"
            ? [
                ...new Map(
                  (groups.data ?? []).map((a) => [
                    a.teachingGroupId,
                    { id: a.teachingGroupId, name: a.teachingGroupName },
                  ]),
                ).values(),
              ]
            : [];
  const save = useSave(
    () => api.post("/score-limit-rules", { ...rule, scopeId: rule.scopeId || null }),
    ["score-limit-rules"],
    () => setRule({ ...rule, maxPoints: "" }),
  );
  return (
    <Toolbar>
      <Select
        aria-label={t("window")}
        value={rule.window}
        onChange={(e) => setRule({ ...rule, window: e.target.value as typeof rule.window })}
        className="sm:w-36"
      >
        {WINDOWS.map((w) => (
          <option key={w} value={w}>
            {t(`windows.${w}`)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t("scope")}
        value={rule.scopeType}
        onChange={(e) => setRule({ ...rule, scopeType: e.target.value as typeof rule.scopeType, scopeId: "" })}
        className="sm:w-40"
      >
        {SCOPES.map((s) => (
          <option key={s} value={s}>
            {t(`scopes.${s}`)}
          </option>
        ))}
      </Select>
      {rule.scopeType !== "GLOBAL" && (
        <Select
          aria-label={t("scopeValue")}
          value={rule.scopeId}
          onChange={(e) => setRule({ ...rule, scopeId: e.target.value })}
          className="sm:w-56"
        >
          <option value="">{t("scopeDefault")}</option>
          {scopeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      )}
      <Input
        aria-label={t("maxPoints")}
        placeholder={t("maxPoints")}
        inputMode="decimal"
        value={rule.maxPoints}
        onChange={(e) => setRule({ ...rule, maxPoints: e.target.value })}
        className="sm:w-28"
      />
      <Button disabled={!rule.maxPoints} loading={save.isPending} onClick={() => save.mutate(undefined)}>
        <Plus className="size-4" aria-hidden />
        {t("addRule")}
      </Button>
    </Toolbar>
  );
}

function RuleRow({ rule, manage }: { rule: ScoreLimitRuleDto; manage: boolean }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const toggle = useSave(
    () => api.patch(`/score-limit-rules/${rule.id}`, { maxPoints: rule.maxPoints, isActive: !rule.isActive }),
    ["score-limit-rules"],
  );
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
      <span className="min-w-0 flex-1">
        {`${t(`windows.${rule.window}`)} · ${t(`scopes.${rule.scopeType}`)}${rule.scopeType === "GLOBAL" ? "" : ` · ${rule.scopeName ?? t("scopeDefault")}`}`}
      </span>
      <span className="tabular font-semibold">{rule.maxPoints}</span>
      <Badge tone={rule.isActive ? "success" : "neutral"}>{t(rule.isActive ? "active" : "inactive")}</Badge>
      {manage && (
        <Button size="sm" variant="ghost" loading={toggle.isPending} onClick={() => toggle.mutate(undefined)}>
          {t(rule.isActive ? "deactivate" : "activate")}
        </Button>
      )}
    </li>
  );
}

function NewCriterionForm() {
  const t = useTranslations("assessment");
  const api = useApi();
  const [name, setName] = useState("");
  const save = useSave(
    () => api.post("/score-criteria", { name: name.trim() }),
    ["score-criteria"],
    () => setName(""),
  );
  return (
    <Toolbar>
      <Input
        aria-label={t("criterionName")}
        placeholder={t("criterionName")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="sm:w-72"
      />
      <Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate(undefined)}>
        <Plus className="size-4" aria-hidden />
        {t("addCriterion")}
      </Button>
    </Toolbar>
  );
}

function CriterionRow({ criterion, manage }: { criterion: ScoreCriterionDto; manage: boolean }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const toggle = useSave(
    () => api.patch(`/score-criteria/${criterion.id}`, { name: criterion.name, isActive: !criterion.isActive }),
    ["score-criteria"],
  );
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <span className="flex-1">{criterion.name}</span>
      <Badge tone={criterion.isActive ? "success" : "neutral"}>{t(criterion.isActive ? "active" : "inactive")}</Badge>
      {manage && (
        <Button size="sm" variant="ghost" loading={toggle.isPending} onClick={() => toggle.mutate(undefined)}>
          {t(criterion.isActive ? "deactivate" : "activate")}
        </Button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- grade scales

function ScalesTab({ manage }: { manage: boolean }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const scales = useQuery({ queryKey: ["grade-scales"], queryFn: () => api.get<GradeScaleDto[]>("/grade-scales") });
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={scales} isEmpty={(s) => s.length === 0} empty={<EmptyState text={t("noScales")} />}>
        {(list) => (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((s) => (
              <Card key={s.id}>
                <CardHeader title={s.name} action={s.inUse ? <Badge tone="primary">{t("inUse")}</Badge> : null} />
                <ul className="divide-y divide-border">
                  {s.bands.map((b) => (
                    <li key={b.label} className="tabular flex justify-between px-4 py-2 text-sm">
                      <span>{`${b.minPercent}–${b.maxPercent}%`}</span>
                      <span className="font-semibold">{b.label}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
      {manage && <NewScaleForm />}
    </div>
  );
}

function NewScaleForm() {
  const t = useTranslations("assessment");
  const api = useApi();
  const [name, setName] = useState("");
  const [bands, setBands] = useState<GradeBand[]>([
    { minPercent: "0", maxPercent: "56", label: "2" },
    { minPercent: "56", maxPercent: "71", label: "3" },
    { minPercent: "71", maxPercent: "86", label: "4" },
    { minPercent: "86", maxPercent: "100", label: "5" },
  ]);
  const save = useSave(
    () => api.post("/grade-scales", { name: name.trim(), bands }),
    ["grade-scales"],
    () => setName(""),
  );
  const setBand = (i: number, patch: Partial<GradeBand>) =>
    setBands(bands.map((b, j) => (i === j ? { ...b, ...patch } : b)));
  return (
    <Card>
      <CardHeader title={t("newScale")} />
      <div className="flex flex-col gap-2 p-4">
        <Input
          aria-label={t("scaleName")}
          placeholder={t("scaleName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {bands.map((b, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <Input
              aria-label={t("bandMin")}
              inputMode="decimal"
              value={b.minPercent}
              onChange={(e) => setBand(i, { minPercent: e.target.value })}
            />
            <Input
              aria-label={t("bandMax")}
              inputMode="decimal"
              value={b.maxPercent}
              onChange={(e) => setBand(i, { maxPercent: e.target.value })}
            />
            <Input
              aria-label={t("bandLabel")}
              value={b.label}
              onChange={(e) => setBand(i, { label: e.target.value })}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("remove")}
              onClick={() => setBands(bands.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setBands([...bands, { minPercent: "", maxPercent: "", label: "" }])}
          >
            <Plus className="size-4" aria-hidden />
            {t("addBand")}
          </Button>
          <Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {t("save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- closing a period (§7)

function ClosingTab() {
  const t = useTranslations("assessment");
  const api = useApi();
  const me = useMe();
  const year = useActiveYear();
  const periods = useQuery({
    queryKey: ["periods", year.data?.id],
    queryFn: () => api.get<AcademicPeriodDto[]>(`/academic-years/${year.data!.id}/periods`),
    enabled: !!year.data,
  });
  const [periodId, setPeriodId] = useState("");
  const chosen = periods.data?.find((p) => p.id === periodId) ?? periods.data?.[0];
  return (
    <QueryBoundary query={periods} isEmpty={(p) => p.length === 0} empty={<EmptyState text={t("noPeriods")} />}>
      {(list) => (
        <div className="flex flex-col gap-4">
          <Card>
            <Toolbar>
              <Select
                aria-label={t("period")}
                value={chosen?.id ?? ""}
                onChange={(e) => setPeriodId(e.target.value)}
                className="sm:w-72"
              >
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.name} (${p.startDate} — ${p.endDate})`}
                  </option>
                ))}
              </Select>
              {chosen && (
                <Badge
                  tone={chosen.status === "CLOSED" ? "neutral" : chosen.status === "ACTIVE" ? "success" : "warning"}
                >
                  {t(`periodStatus.${chosen.status}`)}
                </Badge>
              )}
            </Toolbar>
          </Card>
          {chosen && <PeriodBindings period={chosen} />}
          {chosen && <PeriodClose key={chosen.id} period={chosen} canReopen={can(me.data, "assessment.reopen")} />}
        </div>
      )}
    </QueryBoundary>
  );
}

function PeriodBindings({ period }: { period: AcademicPeriodDto }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const bindings = useQuery({
    queryKey: ["policy-bindings", period.id],
    queryFn: () => api.get<PolicyBindingDto[]>(`/periods/${period.id}/policy-bindings`),
  });
  const policies = useQuery({
    queryKey: ["assessment-policies"],
    queryFn: () => api.get<AssessmentPolicyDto[]>("/assessment/policies"),
  });
  const [versionId, setVersionId] = useState("");
  const [reason, setReason] = useState("");
  const bind = useSave(
    () =>
      api.post(`/periods/${period.id}/bind-policy`, {
        policyVersionId: versionId,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    ["policy-bindings"],
    () => setReason(""),
  );
  const published = (policies.data ?? []).flatMap((p) =>
    p.versions.filter((v) => v.status === "PUBLISHED").map((v) => ({ id: v.id, label: `${p.name} · v${v.version}` })),
  );
  return (
    <Card>
      <CardHeader title={t("bindings")} />
      <QueryBoundary query={bindings} isEmpty={(b) => b.length === 0} empty={<EmptyState text={t("noBindings")} />}>
        {(list) => (
          <ul className="divide-y divide-border">
            {list.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1">{`${b.subjectName ?? t("allSubjects")} · ${b.policyName} v${b.version}`}</span>
                {b.reason && <span className="text-xs text-muted">{b.reason}</span>}
                <Badge tone={b.supersededAt ? "neutral" : "success"}>
                  {t(b.supersededAt ? "superseded" : "current")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
      {period.status !== "CLOSED" && (
        <Toolbar>
          <Select
            aria-label={t("version")}
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            className="sm:w-72"
          >
            <option value="">{t("chooseVersion")}</option>
            {published.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
          <Input
            aria-label={t("reason")}
            placeholder={t("reason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="sm:w-72"
          />
          <Button
            variant="secondary"
            disabled={!versionId}
            loading={bind.isPending}
            onClick={() => bind.mutate(undefined)}
          >
            {t("applyToPeriod")}
          </Button>
        </Toolbar>
      )}
    </Card>
  );
}

function PeriodClose({ period, canReopen }: { period: AcademicPeriodDto; canReopen: boolean }) {
  const t = useTranslations("assessment");
  const api = useApi();
  const runs = useQuery({
    queryKey: ["close-runs", period.id],
    queryFn: () => api.get<PeriodCloseRunDto[]>(`/periods/${period.id}/close-runs`),
  });
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const prepare = useSave(() => api.post(`/periods/${period.id}/prepare-close`), ["close-runs"]);
  const latest = runs.data?.[0];
  const close = useSave(
    () => api.post(`/periods/${period.id}/close`, { runId: latest!.id }),
    ["close-runs", "periods"],
    () => setConfirm(false),
  );
  const recompute = useSave(
    () => api.post(`/periods/${period.id}/recompute`, { reason: reason.trim() }),
    ["close-runs"],
    () => setReason(""),
  );
  return (
    <Card>
      <CardHeader title={t("closing")} />
      <div className="flex flex-col gap-4 p-4">
        {period.status !== "CLOSED" ? (
          <>
            <p className="text-sm text-muted">{t("closingHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={prepare.isPending}
                onClick={() => prepare.mutate(undefined)}
                data-testid="prepare-close"
              >
                {t("prepare")}
              </Button>
              <Button
                disabled={latest?.status !== "PREPARED"}
                onClick={() => setConfirm(true)}
                data-testid="close-period"
              >
                {t("close")}
              </Button>
            </div>
          </>
        ) : (
          canReopen && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("recomputeReason")}>
                {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
              </Field>
              <Button
                variant="secondary"
                disabled={reason.trim().length < 3}
                loading={recompute.isPending}
                onClick={() => recompute.mutate(undefined)}
              >
                {t("recompute")}
              </Button>
            </div>
          )
        )}
        <QueryBoundary query={runs} isEmpty={(r) => r.length === 0} empty={<EmptyState text={t("noRuns")} />}>
          {(list) => {
            const r = list[0]!;
            return (
              <div className="rounded-card border border-border p-3 text-sm" data-testid="close-report">
                <p className="mb-2 font-medium">{`${t(`runStatus.${r.status}`)} · ${r.preparedAt.slice(0, 10)}`}</p>
                <p>
                  {t("reportLine", {
                    students: r.report.students,
                    results: r.report.results,
                    incomplete: r.report.incompleteResults,
                  })}
                </p>
                {Object.entries(r.report.emptyComponents).map(([type, n]) => (
                  <p key={type} className="text-muted">
                    {t("emptyComponentLine", { type: t(`o.componentType.${type}`), n })}
                  </p>
                ))}
                {r.report.pendingByTeacher.length > 0 && (
                  <>
                    <p className="mt-2 font-medium">{t("pendingByTeacher")}</p>
                    <ul className="list-inside list-disc text-muted">
                      {r.report.pendingByTeacher.slice(0, 20).map((p) => (
                        <li key={p.teacherId}>{`${p.teacherName}: ${p.pendingSessions}`}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            );
          }}
        </QueryBoundary>
      </div>
      {confirm && (
        <ConfirmDialog
          open
          title={t("closeConfirmTitle")}
          text={t("closeConfirm", { name: period.name })}
          loading={close.isPending}
          onConfirm={() => close.mutate(undefined)}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- who has not scored

function MissingTab() {
  const t = useTranslations("assessment");
  const api = useApi();
  const today = schoolToday();
  const [from, setFrom] = useState(addSchoolDays(today, -13));
  const [to, setTo] = useState(today);
  const rows = useQuery({
    queryKey: ["missing-scores", from, to],
    queryFn: () =>
      api.get<{ teacherId: string; teacherName: string; lessons: number; unscored: number; unmarked: number }[]>(
        `/reports/missing-scores?from=${from}&to=${to}`,
      ),
  });
  return (
    <Card>
      <Toolbar>
        <Input
          type="date"
          aria-label={t("from")}
          value={from}
          onChange={(e) => setFrom(e.target.value as typeof from)}
          className="sm:w-44"
        />
        <Input
          type="date"
          aria-label={t("to")}
          value={to}
          onChange={(e) => setTo(e.target.value as typeof to)}
          className="sm:w-44"
        />
      </Toolbar>
      <QueryBoundary query={rows} isEmpty={(r) => r.length === 0} empty={<EmptyState text={t("noLessonsInRange")} />}>
        {(list) => (
          <table className="min-w-full text-sm" data-testid="missing-scores">
            <thead>
              <tr className="text-left text-muted">
                <th className="p-2">{t("teacher")}</th>
                <th className="p-2 text-right">{t("lessonsCol")}</th>
                <th className="p-2 text-right">{t("unscored")}</th>
                <th className="p-2 text-right">{t("unmarked")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.teacherId} className="border-t border-border">
                  <td className="p-2">{r.teacherName}</td>
                  <td className="tabular p-2 text-right">{r.lessons}</td>
                  <td className="tabular p-2 text-right font-semibold">{r.unscored}</td>
                  <td className="tabular p-2 text-right">{r.unmarked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryBoundary>
    </Card>
  );
}
