"use client";

// Teacher: quick evaluation (group → student card → criterion, direction and amount) with the limits left shown before
// giving, and their own history where today's evaluations can be undone.
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type {
  CoinCapacityDto,
  CoinTransactionDto,
  CoinWriteResultDto,
  TeacherCoinBoardDto,
  TeacherCoinCriterionDto,
  TeacherCoinStudentDto,
} from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { useSave } from "@/lib/use-save";
import { CoinHistory, newKey, useCoinStatus } from "./common";

export function TeacherCoinsPage() {
  const t = useTranslations("coins");
  const status = useCoinStatus();
  const [tab, setTab] = useState<"give" | "history">("give");
  const [page, setPage] = useState(1);
  const api = useApi();
  const undo = useSave(
    (x: CoinTransactionDto) => api.post(`/coins/transactions/${x.id}/reverse`, { idempotencyKey: newKey() }),
    ["coin-transactions", "coin-board"],
  );
  const today = schoolToday();
  return (
    <>
      <PageHeader title={t("teacher.title")} subtitle={t("teacher.subtitle")} />
      {status.data && (!status.data.isEnabled || !status.data.teacherEvaluationEnabled) && (
        <Card className="mb-4 p-4 text-sm text-warning">{t("teacher.disabled")}</Card>
      )}
      <Tabs
        tabs={[
          { value: "give", label: t("teacher.give") },
          { value: "history", label: t("teacher.history") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "give" ? (
        <Board />
      ) : (
        <Card>
          <CoinHistory
            path="/coins/teacher/transactions"
            queryKey={["teacher"]}
            showStudent
            showTeacher={false}
            page={page}
            onPage={setPage}
            actions={(x) =>
              (x.type === "REWARD" || x.type === "PENALTY") && !x.reversed && x.schoolDate === today ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={undo.isPending && undo.variables?.id === x.id}
                  onClick={() => undo.mutate(x)}
                >
                  <Undo2 className="size-4" aria-hidden />
                  {t("teacher.undo")}
                </Button>
              ) : null
            }
          />
        </Card>
      )}
    </>
  );
}

function Board() {
  const t = useTranslations("coins");
  const api = useApi();
  const board = useQuery({
    queryKey: ["coin-board"],
    queryFn: () => api.get<TeacherCoinBoardDto>("/coins/teacher/board"),
  });
  const [groupId, setGroupId] = useState("");
  const [q, setQ] = useState("");
  const [student, setStudent] = useState<TeacherCoinStudentDto | null>(null);
  return (
    <QueryBoundary query={board}>
      {(b) => {
        const students = b.students.filter(
          (s) =>
            (!groupId || s.groupIds.includes(groupId)) &&
            (!q || `${s.lastName} ${s.firstName}`.toLowerCase().includes(q.toLowerCase())),
        );
        return (
          <>
            <Card className="mb-4">
              <Toolbar>
                <SearchInput value={q} onChange={setQ} label={t("teacher.search")} />
                <FilterSelect
                  label={t("teacher.group")}
                  allLabel={t("teacher.allGroups")}
                  value={groupId}
                  onChange={setGroupId}
                  options={b.groups.map((g) => ({ value: g.id, label: `${g.name} · ${g.subjectName}` }))}
                />
              </Toolbar>
            </Card>
            {b.criteria.length === 0 ? (
              <EmptyState text={t("teacher.noCriteria")} />
            ) : students.length === 0 ? (
              <EmptyState text={t("teacher.noStudents")} />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="coin-students">
                {students.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setStudent(s)}
                      className="flex w-full flex-col items-center gap-2 rounded-card border border-border bg-surface p-3 text-center shadow-card transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <Avatar name={`${s.firstName} ${s.lastName}`} size={44} />
                      <span className="w-full truncate text-sm font-medium">{`${s.lastName} ${s.firstName}`}</span>
                      <span className="flex items-center gap-1 text-xs text-muted">
                        {s.className && <span>{s.className}</span>}
                        <Badge tone={s.balance < 0 ? "danger" : "primary"}>{t("coinsN", { n: s.balance })}</Badge>
                      </span>
                      {s.todayByMe > 0 && (
                        <span className="text-xs text-muted">{t("teacher.todayByMe", { n: s.todayByMe })}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {student && <GiveDialog student={student} criteria={b.criteria} onClose={() => setStudent(null)} />}
          </>
        );
      }}
    </QueryBoundary>
  );
}

function GiveDialog({
  student,
  criteria,
  onClose,
}: {
  student: TeacherCoinStudentDto;
  criteria: TeacherCoinCriterionDto[];
  onClose: () => void;
}) {
  const t = useTranslations("coins");
  const api = useApi();
  const [criterionId, setCriterionId] = useState(criteria[0]!.id);
  const criterion = criteria.find((c) => c.id === criterionId)!;
  const [direction, setDirection] = useState<"REWARD" | "PENALTY">(criterion.type === "PENALTY" ? "PENALTY" : "REWARD");
  const type = criterion.type === "BOTH" ? direction : criterion.type;
  const [amount, setAmount] = useState(criterion.minAmount);
  const capacity = useQuery({
    queryKey: ["coin-capacity", student.id, criterionId, type],
    queryFn: () =>
      api.get<CoinCapacityDto>(
        `/coins/teacher/students/${student.id}/capacity?criterionId=${criterionId}&type=${type}`,
      ),
  });
  const give = useSave(
    () =>
      api.post<CoinWriteResultDto>("/coins/transactions", {
        studentId: student.id,
        criterionId,
        ...(criterion.type === "BOTH" ? { type } : {}),
        amount,
        idempotencyKey: newKey(),
      }),
    ["coin-board", "coin-transactions", "coin-capacity"],
    onClose,
  );
  const pick = (id: string) => {
    const c = criteria.find((x) => x.id === id)!;
    setCriterionId(id);
    setAmount(c.minAmount);
    if (c.type !== "BOTH") setDirection(c.type);
  };
  const amounts = Array.from(
    { length: Math.min(10, criterion.maxAmount - criterion.minAmount + 1) },
    (_, i) => criterion.minAmount + i,
  );
  const cap = capacity.data;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${student.lastName} ${student.firstName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant={type === "PENALTY" ? "danger" : "primary"}
            loading={give.isPending}
            disabled={!!cap?.blocked}
            onClick={() => give.mutate(undefined)}
            data-testid="give-coins"
          >
            {type === "PENALTY" ? t("teacher.takeN", { n: amount }) : t("teacher.giveN", { n: amount })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("teacher.balance", { n: student.balance })}</p>
        <Field label={t("criterion")}>
          {(id) => (
            <Select id={id} value={criterionId} onChange={(e) => pick(e.target.value)}>
              {criteria.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.subjectName ? `${c.name} (${c.subjectName})` : c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {criterion.description && <p className="text-sm text-muted">{criterion.description}</p>}
        {criterion.type === "BOTH" && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("direction")}>
            {(["REWARD", "PENALTY"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => setDirection(d)}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-control border border-border text-sm font-medium",
                  direction === d &&
                    (d === "REWARD"
                      ? "border-success bg-success-soft text-success"
                      : "border-danger bg-danger-soft text-danger"),
                )}
              >
                {d === "REWARD" ? <Plus className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
                {t(`types.${d}`)}
              </button>
            ))}
          </div>
        )}
        <div role="radiogroup" aria-label={t("amount")} className="flex flex-wrap gap-2">
          {amounts.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={amount === n}
              onClick={() => setAmount(n)}
              className={cn(
                "tabular size-11 rounded-control border border-border text-sm font-semibold",
                amount === n && "border-primary bg-primary-soft text-primary-strong",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {cap && (
          <p className={cn("text-sm", cap.blocked ? "text-danger" : "text-muted")} data-testid="coin-capacity">
            {cap.blocked
              ? t("teacher.blocked")
              : cap.remainingAmount === null && cap.remainingCount === null
                ? t("teacher.noLimit")
                : [
                    cap.remainingAmount !== null ? t("teacher.leftAmount", { n: cap.remainingAmount }) : null,
                    cap.remainingCount !== null ? t("teacher.leftCount", { n: cap.remainingCount }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </p>
        )}
      </div>
    </Modal>
  );
}
