"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { schoolToday } from "@idrok/shared/time";
import type { Page, StudentDetail, StudentSummary } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/field";
import { TextField, applyServerErrors, useZodForm } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { FilterSelect, PageHeader, SearchInput, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useClassGroups, personName } from "@/lib/queries";
import { useErrorText } from "@/lib/use-error-text";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { StudentFormSchema, compact, type StudentForm } from "./form-schemas";

const STATUSES = ["ACTIVE", "GRADUATED", "LEFT", "SUSPENDED"] as const;

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("students.status");
  return <Badge tone={status === "ACTIVE" ? "success" : "neutral"}>{t(status)}</Badge>;
}

export function StudentsList({ basePath, variant }: { basePath: string; variant: "admin" | "teacher" }) {
  const t = useTranslations();
  const title = t(variant === "admin" ? "students.title" : "teacher.students");
  const api = useApi();
  const router = useRouter();
  const me = useMe();
  const list = useListState(["classGroupId", "status"] as const);
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const students = useQuery({
    queryKey: ["students", list.apiQuery],
    queryFn: () => api.get<Page<StudentSummary>>(`/students?${list.apiQuery}`),
  });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={title}
        actions={
          can(me.data, "students.create") && (
            <Button onClick={() => setCreating(true)} data-testid="student-create">
              <Plus className="size-4" aria-hidden />
              {t("students.add")}
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput label={t("students.search")} value={list.q} onChange={(q) => list.update({ q })} />
          <FilterSelect
            label={t("students.class")}
            allLabel={t("list.allClasses")}
            value={list.filters.classGroupId}
            onChange={(v) => list.update({ classGroupId: v })}
            options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <FilterSelect
            label={t("students.statusLabel")}
            allLabel={t("list.allStatuses")}
            value={list.filters.status}
            onChange={(v) => list.update({ status: v })}
            options={STATUSES.map((s) => ({ value: s, label: t(`students.status.${s}`) }))}
          />
        </Toolbar>
        <QueryBoundary
          query={students}
          isEmpty={(p) => p.total === 0}
          empty={<EmptyState text={list.q ? t("list.noMatches") : t("students.empty")} />}
        >
          {(p) => (
            <>
              <DataTable
                testId="students-table"
                rows={p.items}
                onRowClick={(s) => router.push(`${basePath}/${s.id}`)}
                columns={[
                  { key: "name", header: t("students.name"), primary: true, cell: (s) => personName(s) },
                  {
                    key: "code",
                    header: t("students.code"),
                    cell: (s) => <span className="tabular">{s.studentCode}</span>,
                  },
                  { key: "class", header: t("students.class"), cell: (s) => s.classGroup?.name ?? "—" },
                  { key: "status", header: t("students.statusLabel"), cell: (s) => <StatusBadge status={s.status} /> },
                  {
                    key: "account",
                    header: t("students.account"),
                    cell: (s) => (s.hasAccount ? t("common.yes") : t("common.no")),
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
      {creating && (
        <CreateStudentDrawer onClose={() => setCreating(false)} onCreated={(id) => router.push(`${basePath}/${id}`)} />
      )}
    </>
  );
}

function CreateStudentDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const errorText = useErrorText();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const form = useZodForm(StudentFormSchema, { validFrom: schoolToday() });
  const create = useMutation({
    mutationFn: (v: StudentForm) => {
      const { classGroupId, validFrom, ...fields } = v;
      return api.post<StudentDetail>("/students", {
        ...compact(fields),
        ...(classGroupId && validFrom ? { enrollment: { classGroupId, validFrom } } : {}),
      });
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["students"] });
      toast("success", t("students.created", { code: s.studentCode }));
      onCreated(s.id);
    },
    onError: (err) => applyServerErrors(form, err) || toast("error", errorText(err)),
  });
  return (
    <Modal
      open
      side="right"
      onClose={onClose}
      title={t("students.add")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="student-form" loading={create.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="student-form" className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
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
        <Field label={t("students.class")}>
          {(id) => (
            <Select id={id} {...form.register("classGroupId")} data-testid="student-class">
              <option value="">—</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField form={form} name="validFrom" type="date" label={t("students.validFrom")} />
      </form>
    </Modal>
  );
}
