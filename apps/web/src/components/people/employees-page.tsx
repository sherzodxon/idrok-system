"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { EmployeeDto, Page } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/field";
import { TextField, applyServerErrors, useZodForm } from "@/components/ui/form";
import { FormDrawer } from "@/components/ui/form-drawer";
import { Modal } from "@/components/ui/modal";
import { OneTimeSecret } from "@/components/ui/secret";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { FilterSelect, PageHeader, SearchInput, Toolbar } from "@/components/ui/toolbar";
import { personName, useRoles } from "@/lib/queries";
import { useErrorText } from "@/lib/use-error-text";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { EmployeeFormSchema, compact, type EmployeeForm } from "./form-schemas";

const STATUSES = ["ACTIVE", "ON_LEAVE", "LEFT"] as const;

export function EmployeesPage() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const list = useListState(["status"] as const);
  const employees = useQuery({
    queryKey: ["employees", list.apiQuery],
    queryFn: () => api.get<Page<EmployeeDto>>(`/employees?${list.apiQuery}`),
  });
  const [editing, setEditing] = useState<EmployeeDto | "new" | null>(null);
  return (
    <>
      <PageHeader
        title={t("employees.title")}
        actions={
          can(me.data, "employees.manage") && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden />
              {t("employees.add")}
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput label={t("employees.search")} value={list.q} onChange={(q) => list.update({ q })} />
          <FilterSelect
            label={t("students.statusLabel")}
            allLabel={t("list.allStatuses")}
            value={list.filters.status}
            onChange={(v) => list.update({ status: v })}
            options={STATUSES.map((s) => ({ value: s, label: t(`employees.status.${s}`) }))}
          />
        </Toolbar>
        <QueryBoundary
          query={employees}
          isEmpty={(p) => p.total === 0}
          empty={<EmptyState text={list.q ? t("list.noMatches") : t("employees.empty")} />}
        >
          {(p) => (
            <>
              <DataTable
                testId="employees-table"
                rows={p.items}
                onRowClick={can(me.data, "employees.manage") ? (e) => setEditing(e) : undefined}
                columns={[
                  { key: "name", header: t("students.name"), primary: true, cell: (e) => personName(e) },
                  { key: "code", header: t("employees.code"), cell: (e) => e.employeeCode ?? "—" },
                  { key: "position", header: t("employees.position"), cell: (e) => e.positionTitle ?? "—" },
                  {
                    key: "status",
                    header: t("students.statusLabel"),
                    cell: (e) => (
                      <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>
                        {t(`employees.status.${e.status}`)}
                      </Badge>
                    ),
                  },
                  {
                    key: "account",
                    header: t("students.account"),
                    cell: (e) => (e.hasAccount ? t("common.yes") : t("common.no")),
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
      {editing && <EmployeeDrawer employee={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EmployeeDrawer({ employee, onClose }: { employee: EmployeeDto | null; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useMe();
  const roles = useRoles(can(me.data, "users.manage"));
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [status, setStatus] = useState(employee?.status ?? "ACTIVE");
  const [secret, setSecret] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const form = useZodForm(
    EmployeeFormSchema,
    employee
      ? {
          lastName: employee.lastName,
          firstName: employee.firstName,
          middleName: employee.middleName ?? undefined,
          phone: employee.phone ?? undefined,
          positionTitle: employee.positionTitle ?? undefined,
          employeeCode: employee.employeeCode ?? undefined,
        }
      : undefined,
  );
  const save = useMutation({
    mutationFn: (v: EmployeeForm) =>
      employee ? api.patch(`/employees/${employee.id}`, { ...compact(v), status }) : api.post("/employees", compact(v)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      toast("success", t("common.saved"));
      onClose();
    },
    onError: (err) => applyServerErrors(form, err) || toast("error", errorText(err)),
  });
  const account = useMutation({
    mutationFn: () =>
      api.post<{ username: string; temporaryPassword: string }>(`/employees/${employee!.id}/account`, { roleIds }),
    onSuccess: (acc) => {
      setSecret(acc);
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => toast("error", errorText(err)),
  });
  if (secret) {
    return (
      <Modal open onClose={onClose} title={t("accounts.created")}>
        <OneTimeSecret username={secret.username} password={secret.temporaryPassword} />
      </Modal>
    );
  }
  const staffRoles = (roles.data ?? []).filter((r) => !["STUDENT", "GUARDIAN", "SUPER_ADMIN"].includes(r.code));
  return (
    <FormDrawer
      title={employee ? personName(employee) : t("employees.add")}
      formId="employee-form"
      busy={save.isPending}
      onClose={onClose}
    >
      <form id="employee-form" className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <TextField form={form} name="lastName" label={t("people.lastName")} />
        <TextField form={form} name="firstName" label={t("people.firstName")} />
        <TextField form={form} name="middleName" label={t("people.middleName")} />
        <TextField form={form} name="phone" type="tel" label={t("people.phone")} />
        <TextField form={form} name="positionTitle" label={t("employees.position")} />
        <TextField form={form} name="employeeCode" label={t("employees.code")} />
        {employee && (
          <Field label={t("students.statusLabel")}>
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`employees.status.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </form>
      {employee && !employee.hasAccount && can(me.data, "users.manage") && (
        <fieldset className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <legend className="text-sm font-medium">{t("accounts.roles")}</legend>
          {staffRoles.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={roleIds.includes(r.id)}
                onChange={(e) =>
                  setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))
                }
              />
              {t.has(`roles.${r.code}`) ? t(`roles.${r.code}`) : r.name}
            </label>
          ))}
          <p className="text-xs text-muted">{t("accounts.defaultRole")}</p>
          <Button variant="secondary" loading={account.isPending} onClick={() => account.mutate()}>
            <KeyRound className="size-4" aria-hidden />
            {t("accounts.create")}
          </Button>
        </fieldset>
      )}
    </FormDrawer>
  );
}
