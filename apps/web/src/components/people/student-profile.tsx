"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Pencil, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { GuardianDto, Page, StudentDetail } from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FormDrawer } from "@/components/ui/form-drawer";
import { Field, Input, Select } from "@/components/ui/field";
import { TextField, applyServerErrors, useZodForm } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { OneTimeSecret } from "@/components/ui/secret";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/toolbar";
import { ApiError } from "@/lib/api-client";
import { personName, useActiveYear, useClassGroups } from "@/lib/queries";
import { useErrorText } from "@/lib/use-error-text";
import { can, useMe } from "@/lib/use-me";
import { GuardianFormSchema, StudentFormSchema, compact, type GuardianForm, type StudentForm } from "./form-schemas";
import { StudentTestsCard } from "@/components/tests/student-tests-card";
import { StudentCoinsCard } from "@/components/coins/portal-coins";
import { StatusBadge } from "./students-list";

const RELATIONS = ["MOTHER", "FATHER", "GRANDPARENT", "SIBLING", "OTHER"] as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="text-sm text-foreground">{children ?? "—"}</dd>
    </div>
  );
}

export function StudentProfile({ id, backHref }: { id: string; backHref: string }) {
  const t = useTranslations();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useMe();
  const student = useQuery({ queryKey: ["student", id], queryFn: () => api.get<StudentDetail>(`/students/${id}`) });
  const [dialog, setDialog] = useState<
    null | "edit" | "transfer" | "archive" | "guardian" | "account" | "accountBelow"
  >(null);
  const [secret, setSecret] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const [unlink, setUnlink] = useState<string | null>(null);
  const refresh = (s?: StudentDetail) => {
    if (s) qc.setQueryData(["student", id], s);
    void qc.invalidateQueries({ queryKey: ["students"] });
  };

  const account = useMutation({
    mutationFn: (allowBelowMinGrade: boolean) =>
      api.post<{ username: string; temporaryPassword: string }>(`/students/${id}/account`, { allowBelowMinGrade }),
    onSuccess: (acc) => {
      setDialog(null);
      setSecret(acc);
      void qc.invalidateQueries({ queryKey: ["student", id] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details?.reason === "STUDENT_BELOW_MIN_GRADE") setDialog("accountBelow");
      else toast("error", errorText(err));
    },
  });
  const unlinkGuardian = useMutation({
    mutationFn: (guardianId: string) => api.delete(`/students/${id}/guardians/${guardianId}`),
    onSuccess: () => {
      setUnlink(null);
      void qc.invalidateQueries({ queryKey: ["student", id] });
    },
    onError: (err) => toast("error", errorText(err)),
  });

  const canUpdate = can(me.data, "students.update");
  const back = (
    <Link href={backHref} className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      {t("common.back")}
    </Link>
  );

  return (
    <QueryBoundary query={student}>
      {(s) => (
        <>
          <PageHeader
            back={back}
            title={personName(s)}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular">{s.studentCode}</span>
                {s.classGroup && <Badge tone="primary">{s.classGroup.name}</Badge>}
                <StatusBadge status={s.status} />
              </span>
            }
            actions={
              <>
                {canUpdate && s.status === "ACTIVE" && (
                  <Button variant="secondary" onClick={() => setDialog("transfer")}>
                    {t("students.transfer")}
                  </Button>
                )}
                {can(me.data, "users.manage") && !s.hasAccount && (
                  <Button
                    variant="secondary"
                    onClick={() => account.mutate(false)}
                    loading={account.isPending}
                    data-testid="student-account"
                  >
                    <KeyRound className="size-4" aria-hidden />
                    {t("accounts.create")}
                  </Button>
                )}
                {can(me.data, "students.archive") && s.status === "ACTIVE" && (
                  <Button variant="ghost" onClick={() => setDialog("archive")}>
                    {t("students.archive")}
                  </Button>
                )}
              </>
            }
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={t("students.info")}
                action={
                  canUpdate && (
                    <Button variant="ghost" size="sm" onClick={() => setDialog("edit")}>
                      <Pencil className="size-4" aria-hidden />
                      {t("common.edit")}
                    </Button>
                  )
                }
              />
              <dl className="flex flex-col gap-3 p-5">
                <Row label={t("people.dateOfBirth")}>{s.dateOfBirth}</Row>
                <Row label={t("people.gender")}>
                  {s.gender ? t(s.gender === "MALE" ? "people.male" : "people.female") : null}
                </Row>
                <Row label={t("people.phone")}>{s.phone}</Row>
                <Row label={t("people.address")}>{s.address}</Row>
                <Row label={t("students.account")}>{s.hasAccount ? t("common.yes") : t("common.no")}</Row>
                {s.notes && <Row label={t("people.notes")}>{s.notes}</Row>}
              </dl>
            </Card>
            <Card>
              <CardHeader
                title={t("guardians.title")}
                action={
                  can(me.data, "guardians.manage") && (
                    <Button variant="ghost" size="sm" onClick={() => setDialog("guardian")} data-testid="guardian-link">
                      <UserPlus className="size-4" aria-hidden />
                      {t("common.add")}
                    </Button>
                  )
                }
              />
              {s.guardians.length === 0 ? (
                <EmptyState text={t("guardians.none")} />
              ) : (
                <ul className="divide-y divide-border">
                  {s.guardians.map((g) => (
                    <li key={g.guardianId} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {g.lastName} {g.firstName}{" "}
                          {g.isPrimary && <Badge tone="primary">{t("guardians.primary")}</Badge>}
                        </p>
                        <p className="text-sm text-muted">
                          {t(`guardians.relations.${g.relation}`)} · <span className="tabular">{g.phone}</span>
                        </p>
                      </div>
                      {can(me.data, "guardians.manage") && (
                        <Button variant="ghost" size="sm" onClick={() => setUnlink(g.guardianId)}>
                          {t("guardians.unlink")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title={t("students.history")} />
              <DataTable
                rows={s.enrollments}
                columns={[
                  { key: "class", header: t("students.class"), primary: true, cell: (e) => e.classGroupName },
                  {
                    key: "from",
                    header: t("students.validFrom"),
                    cell: (e) => <span className="tabular">{e.validFrom}</span>,
                  },
                  {
                    key: "to",
                    header: t("students.validTo"),
                    cell: (e) => <span className="tabular">{e.validTo ?? "—"}</span>,
                  },
                  {
                    key: "status",
                    header: t("students.statusLabel"),
                    cell: (e) => (
                      <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>
                        {t(`students.enrollment.${e.status}`)}
                      </Badge>
                    ),
                  },
                ]}
              />
            </Card>
            {can(me.data, "tests.results.view") && <StudentTestsCard studentId={s.id} />}
            {(can(me.data, "coins.view") || can(me.data, "coins.give")) && <StudentCoinsCard studentId={s.id} />}
          </div>

          {dialog === "edit" && <EditStudentDrawer student={s} onClose={() => setDialog(null)} onSaved={refresh} />}
          {dialog === "transfer" && <TransferDrawer student={s} onClose={() => setDialog(null)} onSaved={refresh} />}
          {dialog === "archive" && <ArchiveDrawer student={s} onClose={() => setDialog(null)} onSaved={refresh} />}
          {dialog === "guardian" && (
            <LinkGuardianDrawer studentId={s.id} onClose={() => setDialog(null)} onSaved={refresh} />
          )}
          <ConfirmDialog
            open={dialog === "accountBelow"}
            title={t("accounts.create")}
            text={t("accounts.belowMinGrade")}
            loading={account.isPending}
            onCancel={() => setDialog(null)}
            onConfirm={() => account.mutate(true)}
          />
          <ConfirmDialog
            open={!!unlink}
            title={t("guardians.unlink")}
            text={t("guardians.unlinkConfirm")}
            danger
            loading={unlinkGuardian.isPending}
            onCancel={() => setUnlink(null)}
            onConfirm={() => unlink && unlinkGuardian.mutate(unlink)}
          />
          <Modal open={!!secret} onClose={() => setSecret(null)} title={t("accounts.created")}>
            {secret && <OneTimeSecret username={secret.username} password={secret.temporaryPassword} />}
          </Modal>
        </>
      )}
    </QueryBoundary>
  );
}

function useStudentMutation(
  path: string,
  method: "post" | "patch",
  onSaved: (s: StudentDetail) => void,
  onClose: () => void,
) {
  const api = useApi();
  const toast = useToast();
  const t = useTranslations("common");
  return useMutation({
    mutationFn: (body: unknown) =>
      method === "post" ? api.post<StudentDetail>(path, body) : api.patch<StudentDetail>(path, body),
    onSuccess: (s) => {
      onSaved(s);
      toast("success", t("saved"));
      onClose();
    },
  });
}

function EditStudentDrawer({
  student,
  onClose,
  onSaved,
}: {
  student: StudentDetail;
  onClose: () => void;
  onSaved: (s: StudentDetail) => void;
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const toast = useToast();
  const form = useZodForm(StudentFormSchema, {
    lastName: student.lastName,
    firstName: student.firstName,
    middleName: student.middleName ?? undefined,
    dateOfBirth: (student.dateOfBirth ?? undefined) as StudentForm["dateOfBirth"],
    gender: student.gender ?? undefined,
    phone: student.phone ?? undefined,
    address: student.address ?? undefined,
    notes: student.notes ?? undefined,
  });
  const save = useStudentMutation(`/students/${student.id}`, "patch", onSaved, onClose);
  return (
    <FormDrawer title={t("common.edit")} formId="edit-student" busy={save.isPending} onClose={onClose}>
      <form
        id="edit-student"
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          const { classGroupId: _c, validFrom: _v, ...fields } = v;
          save.mutate(
            {
              ...fields,
              middleName: fields.middleName ?? null,
              dateOfBirth: fields.dateOfBirth ?? null,
              gender: fields.gender ?? null,
              phone: fields.phone ?? null,
              address: fields.address ?? null,
              notes: fields.notes ?? null,
            },
            { onError: (err) => applyServerErrors(form, err) || toast("error", errorText(err)) },
          );
        })}
      >
        <TextField form={form} name="lastName" label={t("people.lastName")} />
        <TextField form={form} name="firstName" label={t("people.firstName")} />
        <TextField form={form} name="middleName" label={t("people.middleName")} />
        <TextField form={form} name="dateOfBirth" type="date" label={t("people.dateOfBirth")} />
        <Field label={t("people.gender")}>
          {(id) => (
            <Select id={id} {...form.register("gender", { setValueAs: (v: string) => v || undefined })}>
              <option value="">—</option>
              <option value="MALE">{t("people.male")}</option>
              <option value="FEMALE">{t("people.female")}</option>
            </Select>
          )}
        </Field>
        <TextField form={form} name="phone" type="tel" label={t("people.phone")} />
        <TextField form={form} name="address" label={t("people.address")} />
        <TextField form={form} name="notes" label={t("people.notes")} />
      </form>
    </FormDrawer>
  );
}

function TransferDrawer({
  student,
  onClose,
  onSaved,
}: {
  student: StudentDetail;
  onClose: () => void;
  onSaved: (s: StudentDetail) => void;
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const toast = useToast();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const [classGroupId, setClassGroupId] = useState("");
  const [validFrom, setValidFrom] = useState<string>(schoolToday());
  const [reason, setReason] = useState("");
  const save = useStudentMutation(`/students/${student.id}/enrollments`, "post", onSaved, onClose);
  return (
    <FormDrawer title={t("students.transfer")} formId="transfer" busy={save.isPending} onClose={onClose}>
      <form
        id="transfer"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { classGroupId, validFrom, ...(reason ? { reason } : {}) },
            { onError: (err) => toast("error", errorText(err)) },
          );
        }}
      >
        <Field label={t("students.newClass")}>
          {(id) => (
            <Select id={id} required value={classGroupId} onChange={(e) => setClassGroupId(e.target.value)}>
              <option value="">—</option>
              {(classes.data ?? [])
                .filter((c) => c.id !== student.classGroup?.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t("students.validFrom")} hint={t("students.transferHint")}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="date"
              required
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("common.reason")}>
          {(id) => <Input id={id} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </form>
    </FormDrawer>
  );
}

function ArchiveDrawer({
  student,
  onClose,
  onSaved,
}: {
  student: StudentDetail;
  onClose: () => void;
  onSaved: (s: StudentDetail) => void;
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const toast = useToast();
  const [status, setStatus] = useState<"LEFT" | "GRADUATED">("LEFT");
  const [date, setDate] = useState<string>(schoolToday());
  const [reason, setReason] = useState("");
  const save = useStudentMutation(`/students/${student.id}/archive`, "post", onSaved, onClose);
  return (
    <FormDrawer title={t("students.archive")} formId="archive" busy={save.isPending} onClose={onClose}>
      <form
        id="archive"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { status, date, ...(reason ? { reason } : {}) },
            { onError: (err) => toast("error", errorText(err)) },
          );
        }}
      >
        <p className="text-sm text-muted">{t("students.archiveHint")}</p>
        <Field label={t("students.statusLabel")}>
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as "LEFT" | "GRADUATED")}>
              <option value="LEFT">{t("students.status.LEFT")}</option>
              <option value="GRADUATED">{t("students.status.GRADUATED")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("common.date")}>
          {(id) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={t("common.reason")}>
          {(id) => <Input id={id} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </form>
    </FormDrawer>
  );
}

function LinkGuardianDrawer({
  studentId,
  onClose,
  onSaved,
}: {
  studentId: string;
  onClose: () => void;
  onSaved: (s: StudentDetail) => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const errorText = useErrorText();
  const toast = useToast();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [search, setSearch] = useState("");
  const [guardianId, setGuardianId] = useState("");
  const [relation, setRelation] = useState<(typeof RELATIONS)[number]>("MOTHER");
  const [isPrimary, setPrimary] = useState(false);
  const found = useQuery({
    queryKey: ["guardians", "search", search],
    queryFn: () =>
      api.get<Page<GuardianDto>>(`/guardians?pageSize=10&q=${encodeURIComponent(search)}`).then((p) => p.items),
    enabled: mode === "existing" && search.length >= 2,
  });
  const form = useZodForm(GuardianFormSchema);
  const save = useStudentMutation(`/students/${studentId}/guardians`, "post", onSaved, onClose);
  const submit = (newGuardian?: GuardianForm) =>
    save.mutate(
      { relation, isPrimary, ...(newGuardian ? { newGuardian: compact(newGuardian) } : { guardianId }) },
      { onError: (err) => (newGuardian && applyServerErrors(form, err)) || toast("error", errorText(err)) },
    );
  return (
    <FormDrawer title={t("guardians.link")} formId="link-guardian" busy={save.isPending} onClose={onClose}>
      <form
        id="link-guardian"
        className="flex flex-col gap-4"
        onSubmit={mode === "new" ? form.handleSubmit((v) => submit(v)) : (e) => (e.preventDefault(), submit())}
      >
        <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-button bg-surface-muted p-1">
          {(["new", "existing"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-[6px] px-2 py-1.5 text-sm ${mode === m ? "bg-surface shadow-card" : "text-muted"}`}
            >
              {t(m === "new" ? "guardians.new" : "guardians.existing")}
            </button>
          ))}
        </div>
        {mode === "new" ? (
          <>
            <TextField form={form} name="lastName" label={t("people.lastName")} />
            <TextField form={form} name="firstName" label={t("people.firstName")} />
            <TextField form={form} name="phone" type="tel" label={t("people.phone")} hint={t("guardians.phoneHint")} />
          </>
        ) : (
          <>
            <Field label={t("guardians.search")}>
              {(id) => <Input id={id} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}
            </Field>
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {(found.data ?? []).map((g) => (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-button px-2 py-1.5 hover:bg-surface-muted">
                    <input
                      type="radio"
                      name="guardian"
                      checked={guardianId === g.id}
                      onChange={() => setGuardianId(g.id)}
                    />
                    <span className="text-sm">
                      {g.lastName} {g.firstName} · <span className="tabular text-muted">{g.phone}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <Field label={t("guardians.relation")}>
          {(id) => (
            <Select
              id={id}
              value={relation}
              onChange={(e) => setRelation(e.target.value as (typeof RELATIONS)[number])}
            >
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`guardians.relations.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(e.target.checked)} />
          {t("guardians.primary")}
        </label>
      </form>
    </FormDrawer>
  );
}
