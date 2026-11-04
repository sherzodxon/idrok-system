"use client";

// Staff coin pages (MASTER_SPEC §14, ui-structure.md "Coin"): dashboard, the ledger with reversals, corrections and
// manual adjustments, criteria with their teachers, limits, automatic rules and the settings. The API checks every
// permission again; the tabs only hide what the user cannot use.
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Undo2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import type {
  CoinAutoRuleDto,
  LatenessBandDto,
  CoinCriterionDto,
  CoinLimitRuleDto,
  CoinOverviewDto,
  CoinSettingsDto,
  CoinTransactionDto,
  Page,
  StudentSummary,
  TeacherActivityDto,
} from "@idrok/shared";
import { COIN_LIMIT_SCOPES } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stats";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { useEmployees, useSubjects } from "@/lib/queries";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { CoinAmount, CoinHistory, DailyBars, newKey } from "./common";

type Tab = "overview" | "transactions" | "criteria" | "limits" | "auto" | "settings";

export function AdminCoinsPage() {
  const t = useTranslations("coins");
  const me = useMe();
  const tabs = (
    [
      ["overview", "coins.view"],
      ["transactions", "coins.view"],
      ["criteria", "coins.criteria.manage"],
      ["limits", "coins.limits.manage"],
      ["auto", "coins.settings.manage"],
      ["settings", "coins.settings.manage"],
    ] as const
  )
    .filter(([, p]) => can(me.data, p))
    .map(([value]) => ({ value: value as Tab, label: t(`admin.tabs.${value}`) }));
  const [tab, setTab] = useState<Tab>("overview");
  const current = tabs.some((x) => x.value === tab) ? tab : (tabs[0]?.value ?? "overview");
  return (
    <>
      <PageHeader title={t("admin.title")} subtitle={t("admin.subtitle")} />
      <Tabs tabs={tabs} value={current} onChange={setTab} />
      {current === "overview" && <Overview />}
      {current === "transactions" && <Transactions />}
      {current === "criteria" && <Criteria />}
      {current === "limits" && <Limits />}
      {current === "auto" && <AutoRules />}
      {current === "settings" && <SettingsForm />}
    </>
  );
}

// ---------------------------------------------------------------- overview

function Overview() {
  const t = useTranslations("coins");
  const api = useApi();
  const overview = useQuery({
    queryKey: ["coin-overview"],
    queryFn: () => api.get<CoinOverviewDto>("/coins/overview"),
  });
  const ranking = useQuery({
    queryKey: ["coin-ranking"],
    queryFn: () =>
      api.get<{ studentId: string; name: string; className: string | null; balance: number }[]>(
        "/coins/overview/ranking?limit=10",
      ),
  });
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={overview}>
        {(o) => (
          <>
            <p className="text-sm text-muted">{t("admin.range", { from: o.from, to: o.to })}</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="coin-overview">
              <StatCard
                label={t("admin.awarded")}
                value={o.awarded}
                hint={t("admin.evaluations", { n: o.evaluations })}
              />
              <StatCard label={t("admin.penalties")} value={o.penalties} />
              <StatCard label={t("admin.automatic")} value={o.automatic} />
              <StatCard label={t("admin.spent")} value={o.spent} />
              <StatCard label={t("admin.totalBalance")} value={o.totalBalance} />
              <StatCard label={t("admin.inDebt")} value={o.studentsInDebt} />
              <StatCard label={t("admin.pendingOrders")} value={o.pendingOrders} />
              <StatCard label={t("admin.adjustments")} value={o.adjustments} />
            </div>
            <Card className="p-5">
              <h2 className="mb-3 text-base font-semibold text-foreground">{t("admin.byDay")}</h2>
              <DailyBars
                series={o.series.map((d) => ({ date: d.date, earned: d.awarded, penalties: d.penalties }))}
                labels={{ earned: t("admin.awarded"), penalties: t("admin.penalties") }}
              />
            </Card>
            <Card>
              <CardHeader title={t("admin.byCriterion")} />
              {o.byCriterion.length === 0 ? (
                <EmptyState text={t("noTransactions")} />
              ) : (
                <DataTable
                  rows={o.byCriterion.map((c) => ({ ...c, id: c.id ?? c.name }))}
                  columns={[
                    { key: "name", header: t("criterion"), primary: true, cell: (c) => c.name },
                    { key: "awarded", header: t("admin.awarded"), cell: (c) => <CoinAmount value={c.awarded} /> },
                    {
                      key: "penalties",
                      header: t("admin.penalties"),
                      cell: (c) => <CoinAmount value={-c.penalties} />,
                    },
                    { key: "count", header: t("admin.count"), cell: (c) => c.count },
                  ]}
                />
              )}
            </Card>
          </>
        )}
      </QueryBoundary>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.ranking")} />
          <QueryBoundary
            query={ranking}
            isEmpty={(r) => r.length === 0}
            empty={<EmptyState text={t("admin.noBalances")} />}
          >
            {(rows) => (
              <ol className="divide-y divide-border" data-testid="coin-ranking">
                {rows.map((r, i) => (
                  <li key={r.studentId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="tabular mr-2 text-muted">{i + 1}.</span>
                      {r.name}
                      {r.className && <span className="ml-1 text-muted">· {r.className}</span>}
                    </span>
                    <span className="tabular font-semibold">{r.balance}</span>
                  </li>
                ))}
              </ol>
            )}
          </QueryBoundary>
        </Card>
        <TeacherActivity />
      </div>
    </div>
  );
}

const ACTIVITY_TONE = {
  ACTIVE: "success",
  LOW_ACTIVITY: "warning",
  INACTIVE: "danger",
  UNASSIGNED: "neutral",
} as const;

function TeacherActivity() {
  const t = useTranslations("coins");
  const api = useApi();
  const activity = useQuery({
    queryKey: ["coin-activity"],
    queryFn: () => api.get<TeacherActivityDto>("/coins/overview/teachers"),
  });
  return (
    <Card>
      <QueryBoundary query={activity}>
        {(a) => (
          <>
            <CardHeader
              title={t("admin.activity")}
              action={
                <span className="text-xs text-muted">
                  {t("admin.activityRule", { days: a.rule.windowDays, coverage: a.rule.minCoverage })}
                </span>
              }
            />
            {a.teachers.length === 0 ? (
              <EmptyState text={t("admin.noTeachers")} />
            ) : (
              <DataTable
                testId="coin-activity"
                rows={a.teachers.map((x) => ({ ...x, id: x.teacherId }))}
                columns={[
                  { key: "name", header: t("admin.teacher"), primary: true, cell: (x) => x.name },
                  {
                    key: "status",
                    header: t("admin.status"),
                    cell: (x) => (
                      <span title={t(`admin.activityReasons.${x.reason}`)}>
                        <Badge tone={ACTIVITY_TONE[x.status]}>{t(`admin.activityStatus.${x.status}`)}</Badge>
                      </span>
                    ),
                  },
                  {
                    key: "coverage",
                    header: t("admin.coverage"),
                    cell: (x) => `${x.coverage}% (${x.windowStudents}/${x.assignedStudents})`,
                  },
                  { key: "last", header: t("admin.last"), cell: (x) => x.lastEvaluation ?? "—" },
                ]}
              />
            )}
          </>
        )}
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- transactions

const TX_TYPES = ["REWARD", "PENALTY", "PURCHASE", "REFUND", "ADMIN_ADJUSTMENT", "REVERSAL", "CORRECTION"] as const;

function Transactions() {
  const t = useTranslations("coins");
  const me = useMe();
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [reverse, setReverse] = useState<CoinTransactionDto | null>(null);
  const [correct, setCorrect] = useState<CoinTransactionDto | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const params = new URLSearchParams({ ...(type ? { type } : {}), ...(q ? { q } : {}) }).toString();
  const reversible = (x: CoinTransactionDto) =>
    !x.reversed && (x.type === "REWARD" || x.type === "PENALTY" || x.type === "ADMIN_ADJUSTMENT");
  return (
    <Card>
      <Toolbar>
        <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} label={t("admin.searchStudent")} />
        <FilterSelect
          label={t("kind")}
          allLabel={t("admin.allKinds")}
          value={type}
          onChange={(v) => (setType(v), setPage(1))}
          options={TX_TYPES.map((x) => ({ value: x, label: t(`types.${x}`) }))}
        />
        {can(me.data, "coins.adjust") && (
          <Button onClick={() => setAdjusting(true)}>
            <Plus className="size-4" aria-hidden />
            {t("admin.adjust")}
          </Button>
        )}
      </Toolbar>
      <CoinHistory
        path={`/coins/transactions${params ? `?${params}` : ""}`}
        queryKey={["all", params]}
        showStudent
        page={page}
        onPage={setPage}
        testId="coin-ledger"
        actions={(x) =>
          can(me.data, "coins.reverse") && reversible(x) ? (
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setReverse(x)} aria-label={t("admin.reverse")}>
                <Undo2 className="size-4" aria-hidden />
              </Button>
              {(x.type === "REWARD" || x.type === "PENALTY") && Math.abs(x.effectiveAmount ?? 0) > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setCorrect(x)} aria-label={t("admin.correct")}>
                  <Pencil className="size-4" aria-hidden />
                </Button>
              )}
            </span>
          ) : null
        }
      />
      {reverse && <ReverseDialog tx={reverse} onClose={() => setReverse(null)} />}
      {correct && <CorrectDialog tx={correct} onClose={() => setCorrect(null)} />}
      {adjusting && <AdjustDrawer onClose={() => setAdjusting(false)} />}
    </Card>
  );
}

function ReverseDialog({ tx, onClose }: { tx: CoinTransactionDto; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const [reason, setReason] = useState("");
  const save = useSave(
    () => api.post(`/coins/transactions/${tx.id}/reverse`, { reason, idempotencyKey: newKey() }),
    ["coin-transactions", "coin-overview", "coin-ranking"],
    onClose,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.reverseTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            loading={save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            {t("admin.reverse")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        {t("admin.reverseText", { student: tx.studentName, n: tx.effectiveAmount ?? tx.amount })}
      </p>
      <Field label={t("reason")}>
        {(id) => <Input id={id} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}

function CorrectDialog({ tx, onClose }: { tx: CoinTransactionDto; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const current = Math.abs(tx.effectiveAmount ?? tx.amount);
  const [value, setValue] = useState(String(Math.max(1, current - 1)));
  const [reason, setReason] = useState("");
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n < current && reason.trim();
  const save = useSave(
    () =>
      api.post(`/coins/transactions/${tx.id}/correct`, {
        amount: tx.amount < 0 ? -n : n,
        reason,
        idempotencyKey: newKey(),
      }),
    ["coin-transactions", "coin-overview", "coin-ranking"],
    onClose,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.correctTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("admin.correctText", { student: tx.studentName, n: current })}</p>
        <Field label={t("admin.newAmount")} hint={t("admin.correctHint")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={current - 1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("reason")}>
          {(id) => <Input id={id} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function AdjustDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const [q, setQ] = useState("");
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const students = useQuery({
    queryKey: ["students", "coin-adjust", q],
    queryFn: () =>
      api.get<Page<StudentSummary>>(`/students?pageSize=20&status=ACTIVE${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  });
  const save = useSave(
    () => api.post("/coins/adjustments", { studentId, amount: Number(amount), reason, idempotencyKey: newKey() }),
    ["coin-transactions", "coin-overview", "coin-ranking"],
    onClose,
  );
  return (
    <FormDrawer title={t("admin.adjust")} formId="coin-adjust" busy={save.isPending} onClose={onClose}>
      <form
        id="coin-adjust"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <SearchInput value={q} onChange={setQ} label={t("admin.searchStudent")} />
        <Field label={t("student")}>
          {(id) => (
            <Select id={id} required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">{t("admin.pickStudent")}</option>
              {(students.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.lastName} ${s.firstName}${s.classGroup ? ` · ${s.classGroup.name}` : ""}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("amount")} hint={t("admin.adjustHint")}>
          {(id) => (
            <Input id={id} type="number" required step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}
        </Field>
        <Field label={t("reason")}>
          {(id) => (
            <Input id={id} required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- criteria

function Criteria() {
  const t = useTranslations("coins");
  const api = useApi();
  const criteria = useQuery({
    queryKey: ["coin-criteria"],
    queryFn: () => api.get<CoinCriterionDto[]>("/coins/criteria"),
  });
  const [editing, setEditing] = useState<CoinCriterionDto | "new" | null>(null);
  const [teachersOf, setTeachersOf] = useState<CoinCriterionDto | null>(null);
  return (
    <Card>
      <CardHeader
        title={t("admin.tabs.criteria")}
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            {t("admin.addCriterion")}
          </Button>
        }
      />
      <QueryBoundary
        query={criteria}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState text={t("admin.noCriteria")} />}
      >
        {(list) => (
          <DataTable
            testId="coin-criteria"
            rows={list}
            columns={[
              {
                key: "name",
                header: t("criterion"),
                primary: true,
                cell: (c) => (
                  <span className={c.isActive ? "font-medium" : "text-muted line-through"}>
                    {c.name}
                    {c.subjectName && <span className="ml-1 text-xs text-muted">({c.subjectName})</span>}
                  </span>
                ),
              },
              {
                key: "type",
                header: t("direction"),
                cell: (c) => (
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={c.type === "PENALTY" ? "danger" : c.type === "REWARD" ? "success" : "primary"}>
                      {t(`criterionTypes.${c.type}`)}
                    </Badge>
                    {c.isAutomatic && <Badge>{t("admin.automaticBadge")}</Badge>}
                  </span>
                ),
              },
              { key: "range", header: t("amount"), cell: (c) => `${c.minAmount}–${c.maxAmount}` },
              {
                key: "who",
                header: t("admin.who"),
                cell: (c) =>
                  c.eligibility === "ALL_TEACHERS"
                    ? t("admin.allTeachers")
                    : t("admin.selectedN", { n: c.teacherIds.length }),
              },
              { key: "used", header: t("admin.count"), cell: (c) => c.transactionCount },
              {
                key: "actions",
                header: "",
                cell: (c) => (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={t("edit")}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    {c.eligibility === "SELECTED_TEACHERS" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setTeachersOf(c)}
                        aria-label={t("admin.teachers")}
                      >
                        <Users className="size-4" aria-hidden />
                      </Button>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && <CriterionDrawer criterion={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {teachersOf && <CriterionTeachers criterion={teachersOf} onClose={() => setTeachersOf(null)} />}
    </Card>
  );
}

function Check({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function CriterionDrawer({ criterion, onClose }: { criterion: CoinCriterionDto | null; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const subjects = useSubjects();
  const [d, setD] = useState({
    name: criterion?.name ?? "",
    description: criterion?.description ?? "",
    type: criterion?.type ?? ("REWARD" as CoinCriterionDto["type"]),
    minAmount: String(criterion?.minAmount ?? 1),
    maxAmount: String(criterion?.maxAmount ?? 5),
    subjectId: criterion?.subjectId ?? "",
    eligibility: criterion?.eligibility ?? ("SELECTED_TEACHERS" as CoinCriterionDto["eligibility"]),
    isAutomatic: criterion?.isAutomatic ?? false,
    isActive: criterion?.isActive ?? true,
  });
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const body = () => ({
    ...d,
    description: d.description || null,
    minAmount: Number(d.minAmount),
    maxAmount: Number(d.maxAmount),
    subjectId: d.subjectId || null,
  });
  const save = useSave(
    () => (criterion ? api.put(`/coins/criteria/${criterion.id}`, body()) : api.post("/coins/criteria", body())),
    ["coin-criteria"],
    onClose,
  );
  return (
    <FormDrawer
      title={criterion ? t("admin.editCriterion") : t("admin.addCriterion")}
      formId="coin-criterion"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="coin-criterion"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("admin.name")}>
          {(id) => (
            <Input id={id} required maxLength={100} value={d.name} onChange={(e) => set({ name: e.target.value })} />
          )}
        </Field>
        <Field label={t("admin.description")}>
          {(id) => (
            <Input
              id={id}
              maxLength={500}
              value={d.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("direction")}>
          {(id) => (
            <Select id={id} value={d.type} onChange={(e) => set({ type: e.target.value as typeof d.type })}>
              {(["REWARD", "PENALTY", "BOTH"] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`criterionTypes.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("admin.min")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                required
                value={d.minAmount}
                onChange={(e) => set({ minAmount: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("admin.max")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                required
                value={d.maxAmount}
                onChange={(e) => set({ maxAmount: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label={t("admin.subject")} hint={t("admin.subjectHint")}>
          {(id) => (
            <Select id={id} value={d.subjectId} onChange={(e) => set({ subjectId: e.target.value })}>
              <option value="">{t("admin.anySubject")}</option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.who")}>
          {(id) => (
            <Select
              id={id}
              value={d.eligibility}
              onChange={(e) => set({ eligibility: e.target.value as typeof d.eligibility })}
            >
              <option value="SELECTED_TEACHERS">{t("admin.selectedTeachers")}</option>
              <option value="ALL_TEACHERS">{t("admin.allTeachers")}</option>
            </Select>
          )}
        </Field>
        <Check label={t("admin.isAutomatic")} checked={d.isAutomatic} onChange={(v) => set({ isAutomatic: v })} />
        <Check label={t("admin.isActive")} checked={d.isActive} onChange={(v) => set({ isActive: v })} />
      </form>
    </FormDrawer>
  );
}

function CriterionTeachers({ criterion, onClose }: { criterion: CoinCriterionDto; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const employees = useEmployees();
  const [ids, setIds] = useState<string[]>(criterion.teacherIds);
  const [q, setQ] = useState("");
  const save = useSave(
    () => api.put(`/coins/criteria/${criterion.id}/teachers`, { teacherIds: ids }),
    ["coin-criteria"],
    onClose,
  );
  const list = (employees.data ?? []).filter((e) =>
    `${e.lastName} ${e.firstName}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <FormDrawer
      title={t("admin.teachersOf", { name: criterion.name })}
      formId="coin-teachers"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="coin-teachers"
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <SearchInput value={q} onChange={setQ} label={t("admin.searchTeacher")} />
        <QueryBoundary
          query={employees}
          isEmpty={(l) => l.length === 0}
          empty={<EmptyState text={t("admin.noTeachers")} />}
        >
          {() => (
            <div className="flex flex-col gap-2">
              {list.map((e) => (
                <Check
                  key={e.id}
                  label={`${e.lastName} ${e.firstName}`}
                  checked={ids.includes(e.id)}
                  onChange={(v) => setIds((x) => (v ? [...x, e.id] : x.filter((y) => y !== e.id)))}
                />
              ))}
            </div>
          )}
        </QueryBoundary>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- limits

function useLimitText() {
  const t = useTranslations("coins");
  return (r: Pick<CoinLimitRuleDto, "period" | "durationMinutes" | "maxAmount" | "maxCount">) =>
    [
      r.period === "ROLLING" ? t("periods.ROLLING", { minutes: r.durationMinutes ?? 0 }) : t(`periods.${r.period}`),
      r.maxAmount !== null ? t("admin.maxCoins", { n: r.maxAmount }) : null,
      r.maxCount !== null ? t("admin.maxTimes", { n: r.maxCount }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

function Limits() {
  const t = useTranslations("coins");
  const api = useApi();
  const limits = useQuery({ queryKey: ["coin-limits"], queryFn: () => api.get<CoinLimitRuleDto[]>("/coins/limits") });
  const [editing, setEditing] = useState<CoinLimitRuleDto | "new" | null>(null);
  const text = useLimitText();
  const off = useSave((id: string) => api.delete(`/coins/limits/${id}`), ["coin-limits"]);
  return (
    <Card>
      <CardHeader
        title={t("admin.tabs.limits")}
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            {t("admin.addLimit")}
          </Button>
        }
      />
      <p className="px-5 pb-3 text-sm text-muted">{t("admin.limitsHelp")}</p>
      <QueryBoundary query={limits} isEmpty={(l) => l.length === 0} empty={<EmptyState text={t("admin.noLimits")} />}>
        {(list) => (
          <DataTable
            testId="coin-limits"
            rows={list}
            columns={[
              {
                key: "scope",
                header: t("admin.scope"),
                primary: true,
                cell: (r) => (
                  <span className={r.isActive ? "" : "text-muted line-through"}>
                    {t(`scopes.${r.scope}`)}
                    {(r.criterionName || r.teacherName) && (
                      <span className="ml-1 text-xs text-muted">
                        ({[r.teacherName, r.criterionName].filter(Boolean).join(" · ")})
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "type",
                header: t("direction"),
                cell: (r) =>
                  r.type
                    ? t(`types.${r.type}`)
                    : r.countTypesSeparately
                      ? t("admin.bothSeparate")
                      : t("admin.bothShared"),
              },
              { key: "limit", header: t("admin.limit"), cell: (r) => text(r) },
              {
                key: "actions",
                header: "",
                cell: (r) => (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={t("edit")}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    {r.isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={off.isPending && off.variables === r.id}
                        onClick={() => off.mutate(r.id)}
                      >
                        {t("admin.deactivate")}
                      </Button>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && <LimitDrawer rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function LimitDrawer({ rule, onClose }: { rule: CoinLimitRuleDto | null; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const employees = useEmployees();
  const criteria = useQuery({
    queryKey: ["coin-criteria"],
    queryFn: () => api.get<CoinCriterionDto[]>("/coins/criteria"),
  });
  const [d, setD] = useState({
    scope: rule?.scope ?? ("GLOBAL" as CoinLimitRuleDto["scope"]),
    criterionId: rule?.criterionId ?? "",
    teacherId: rule?.teacherId ?? "",
    type: rule?.type ?? "",
    period: rule?.period ?? ("DAY" as CoinLimitRuleDto["period"]),
    durationMinutes: String(rule?.durationMinutes ?? 60),
    maxAmount: rule?.maxAmount === null || rule?.maxAmount === undefined ? "" : String(rule.maxAmount),
    maxCount: rule?.maxCount === null || rule?.maxCount === undefined ? "" : String(rule.maxCount),
    countTypesSeparately: rule?.countTypesSeparately ?? false,
    isActive: rule?.isActive ?? true,
  });
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const needsCriterion = d.scope === "CRITERION" || d.scope === "TEACHER_CRITERION";
  const needsTeacher = d.scope === "TEACHER" || d.scope === "TEACHER_CRITERION";
  const body = () => ({
    scope: d.scope,
    criterionId: needsCriterion ? d.criterionId || null : null,
    teacherId: needsTeacher ? d.teacherId || null : null,
    type: d.type || null,
    period: d.period,
    durationMinutes: d.period === "ROLLING" ? Number(d.durationMinutes) : null,
    maxAmount: d.maxAmount ? Number(d.maxAmount) : null,
    maxCount: d.maxCount ? Number(d.maxCount) : null,
    countTypesSeparately: !d.type && d.countTypesSeparately,
    isActive: d.isActive,
  });
  const save = useSave(
    () => (rule ? api.put(`/coins/limits/${rule.id}`, body()) : api.post("/coins/limits", body())),
    ["coin-limits"],
    onClose,
  );
  return (
    <FormDrawer
      title={rule ? t("admin.editLimit") : t("admin.addLimit")}
      formId="coin-limit"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="coin-limit"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("admin.scope")} hint={t(`scopeHelp.${d.scope}`)}>
          {(id) => (
            <Select id={id} value={d.scope} onChange={(e) => set({ scope: e.target.value as typeof d.scope })}>
              {COIN_LIMIT_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {t(`scopes.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {needsTeacher && (
          <Field label={t("admin.teacher")}>
            {(id) => (
              <Select id={id} required value={d.teacherId} onChange={(e) => set({ teacherId: e.target.value })}>
                <option value="">—</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{`${e.lastName} ${e.firstName}`}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {needsCriterion && (
          <Field label={t("criterion")}>
            {(id) => (
              <Select id={id} required value={d.criterionId} onChange={(e) => set({ criterionId: e.target.value })}>
                <option value="">—</option>
                {(criteria.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("direction")}>
          {(id) => (
            <Select id={id} value={d.type} onChange={(e) => set({ type: e.target.value as typeof d.type })}>
              <option value="">{t("admin.bothTypes")}</option>
              <option value="REWARD">{t("types.REWARD")}</option>
              <option value="PENALTY">{t("types.PENALTY")}</option>
            </Select>
          )}
        </Field>
        {!d.type && (
          <Check
            label={t("admin.countTypesSeparately")}
            checked={d.countTypesSeparately}
            onChange={(v) => set({ countTypesSeparately: v })}
          />
        )}
        <Field label={t("admin.period")}>
          {(id) => (
            <Select id={id} value={d.period} onChange={(e) => set({ period: e.target.value as typeof d.period })}>
              {(["DAY", "WEEK", "MONTH", "ROLLING"] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`admin.periodNames.${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {d.period === "ROLLING" && (
          <Field label={t("admin.durationMinutes")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                required
                value={d.durationMinutes}
                onChange={(e) => set({ durationMinutes: e.target.value })}
              />
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("admin.maxAmount")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                value={d.maxAmount}
                onChange={(e) => set({ maxAmount: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("admin.maxCount")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                value={d.maxCount}
                onChange={(e) => set({ maxCount: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Check label={t("admin.isActive")} checked={d.isActive} onChange={(v) => set({ isActive: v })} />
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- automatic rules

function useBands() {
  const api = useApi();
  return useQuery({
    queryKey: ["lateness-bands"],
    queryFn: () => api.get<LatenessBandDto[]>("/attendance/lateness-bands"),
  });
}

function AutoRules() {
  const t = useTranslations("coins");
  const api = useApi();
  const rules = useQuery({
    queryKey: ["coin-auto-rules"],
    queryFn: () => api.get<CoinAutoRuleDto[]>("/coins/auto-rules"),
  });
  const bands = useBands();
  const bandName = (id: string) => bands.data?.find((b) => b.id === id)?.name ?? "—";
  const [editing, setEditing] = useState<CoinAutoRuleDto | "new" | null>(null);
  const ruleText = (r: CoinAutoRuleDto) =>
    r.source === "TEST_RESULT"
      ? t("admin.autoRuleText", { percent: r.config.minPercent, n: r.config.amount })
      : r.config.latenessBandId === null
        ? t("admin.attendanceOnTimeText", { n: r.config.amount })
        : t("admin.attendanceLateText", { band: bandName(r.config.latenessBandId), n: r.config.amount });
  return (
    <Card>
      <CardHeader
        title={t("admin.tabs.auto")}
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            {t("admin.addAutoRule")}
          </Button>
        }
      />
      <p className="px-5 pb-3 text-sm text-muted">{t("admin.autoHelp")}</p>
      <QueryBoundary query={rules} isEmpty={(l) => l.length === 0} empty={<EmptyState text={t("admin.noAutoRules")} />}>
        {(list) => (
          <DataTable
            testId="coin-auto-rules"
            rows={list}
            columns={[
              {
                key: "rule",
                header: t("admin.rule"),
                primary: true,
                cell: (r) => <span className={r.isActive ? "" : "text-muted line-through"}>{ruleText(r)}</span>,
              },
              { key: "source", header: t("admin.source"), cell: (r) => t(`admin.sources.${r.source}`) },
              {
                key: "purposes",
                header: t("admin.purposes"),
                cell: (r) =>
                  r.source !== "TEST_RESULT"
                    ? "—"
                    : r.config.purposes.length
                      ? r.config.purposes.map((p) => t(`purposes.${p}`)).join(", ")
                      : t("admin.allTests"),
              },
              { key: "criterion", header: t("criterion"), cell: (r) => r.criterionName },
              {
                key: "actions",
                header: "",
                cell: (r) => (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={t("edit")}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && <AutoRuleDrawer rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function AutoRuleDrawer({ rule, onClose }: { rule: CoinAutoRuleDto | null; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const criteria = useQuery({
    queryKey: ["coin-criteria"],
    queryFn: () => api.get<CoinCriterionDto[]>("/coins/criteria"),
  });
  const bands = useBands();
  const [source, setSource] = useState<CoinAutoRuleDto["source"]>(rule?.source ?? "TEST_RESULT");
  const test = rule?.source === "TEST_RESULT" ? rule.config : null;
  const attendance = rule?.source === "ATTENDANCE" ? rule.config : null;
  const [criterionId, setCriterionId] = useState(rule?.criterionId ?? "");
  const [minPercent, setMinPercent] = useState(String(test?.minPercent ?? 90));
  const [amount, setAmount] = useState(String(rule?.config.amount ?? (rule ? 1 : 3)));
  const [purposes, setPurposes] = useState<("PRACTICE" | "WEIGHTED")[]>(test?.purposes ?? []);
  /** "" = on time, otherwise a lateness band. */
  const [outcome, setOutcome] = useState(attendance?.latenessBandId ?? "");
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const body = () =>
    source === "TEST_RESULT"
      ? {
          source,
          criterionId,
          config: { minPercent: Number(minPercent), amount: Number(amount), purposes },
          isActive,
        }
      : { source, criterionId, config: { latenessBandId: outcome || null, amount: Number(amount) }, isActive };
  const save = useSave(
    () => (rule ? api.put(`/coins/auto-rules/${rule.id}`, body()) : api.post("/coins/auto-rules", body())),
    ["coin-auto-rules"],
    onClose,
  );
  // Test results and "on time" reward; a lateness band takes.
  const takes = source === "ATTENDANCE" && outcome !== "";
  return (
    <FormDrawer
      title={rule ? t("admin.editAutoRule") : t("admin.addAutoRule")}
      formId="coin-auto"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="coin-auto"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("admin.source")}>
          {(id) => (
            <Select
              id={id}
              value={source}
              disabled={!!rule}
              onChange={(e) => {
                setSource(e.target.value as CoinAutoRuleDto["source"]);
                setCriterionId("");
              }}
            >
              {(["TEST_RESULT", "ATTENDANCE"] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`admin.sources.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {source === "ATTENDANCE" && (
          <Field label={t("admin.outcome")} hint={t("admin.outcomeHint")}>
            {(id) => (
              <Select
                id={id}
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value);
                  setCriterionId("");
                }}
              >
                <option value="">{t("admin.onTime")}</option>
                {(bands.data ?? [])
                  .filter((b) => !b.archived || b.id === outcome)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {t("admin.lateBand", { band: b.name })}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("criterion")} hint={takes ? t("admin.autoPenaltyHint") : t("admin.autoCriterionHint")}>
          {(id) => (
            <Select id={id} required value={criterionId} onChange={(e) => setCriterionId(e.target.value)}>
              <option value="">—</option>
              {(criteria.data ?? [])
                .filter((c) => c.isActive && c.type !== (takes ? "REWARD" : "PENALTY"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {source === "TEST_RESULT" && (
            <Field label={t("admin.minPercent")}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={minPercent}
                  onChange={(e) => setMinPercent(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label={t("amount")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
        </div>
        {source === "TEST_RESULT" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("admin.purposes")}</legend>
            {(["PRACTICE", "WEIGHTED"] as const).map((p) => (
              <Check
                key={p}
                label={t(`purposes.${p}`)}
                checked={purposes.includes(p)}
                onChange={(v) => setPurposes((x) => (v ? [...x, p] : x.filter((y) => y !== p)))}
              />
            ))}
            <p className="text-xs text-muted">{t("admin.purposesHint")}</p>
          </fieldset>
        )}
        <Check label={t("admin.isActive")} checked={isActive} onChange={setIsActive} />
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- settings

const SWITCHES = [
  "isEnabled",
  "rewardsEnabled",
  "penaltiesEnabled",
  "teacherEvaluationEnabled",
  "adminAdjustmentEnabled",
  "autoCoinsEnabled",
  "shopEnabled",
  "newOrdersEnabled",
  "orderApprovalRequired",
  "allowNegativeBalance",
] as const;

function SettingsForm() {
  const api = useApi();
  const settings = useQuery({
    queryKey: ["coin-settings"],
    queryFn: () => api.get<CoinSettingsDto>("/coins/settings"),
  });
  return (
    <QueryBoundary query={settings}>{(s) => <SettingsEditor key={JSON.stringify(s)} initial={s} />}</QueryBoundary>
  );
}

function SettingsEditor({ initial }: { initial: CoinSettingsDto }) {
  const t = useTranslations("coins");
  const api = useApi();
  const [d, setD] = useState(initial);
  const [maxDebt, setMaxDebt] = useState(initial.maxDebt === null ? "" : String(initial.maxDebt));
  const set = (patch: Partial<CoinSettingsDto>) => setD((x) => ({ ...x, ...patch }));
  const save = useSave(
    () =>
      api.put("/coins/settings", {
        ...d,
        maxDebt: d.allowNegativeBalance && maxDebt !== "" ? Number(maxDebt) : null,
      }),
    ["coin-settings", "coin-status"],
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      data-testid="coin-settings"
    >
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-semibold text-foreground">{t("admin.switches")}</h2>
        {SWITCHES.map((k) => (
          <Check key={k} label={t(`settings.${k}`)} checked={d[k]} onChange={(v) => set({ [k]: v })} />
        ))}
        {d.allowNegativeBalance && (
          <Field label={t("settings.maxDebt")} hint={t("settings.maxDebtHint")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                value={maxDebt}
                onChange={(e) => setMaxDebt(e.target.value)}
                className="w-40"
              />
            )}
          </Field>
        )}
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <h2 className="text-base font-semibold text-foreground sm:col-span-3">{t("admin.activity")}</h2>
        <Field label={t("settings.activityWindowDays")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={90}
              value={d.activityWindowDays}
              onChange={(e) => set({ activityWindowDays: Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label={t("settings.activityMinCoverage")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={100}
              value={d.activityMinCoverage}
              onChange={(e) => set({ activityMinCoverage: Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label={t("settings.activityStaleDays")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={90}
              value={d.activityStaleDays}
              onChange={(e) => set({ activityStaleDays: Number(e.target.value) })}
            />
          )}
        </Field>
      </Card>
      <div>
        <Button type="submit" loading={save.isPending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
