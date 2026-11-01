"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { GuardianDto, Page } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { TextField, applyServerErrors, useZodForm } from "@/components/ui/form";
import { FormDrawer } from "@/components/ui/form-drawer";
import { Modal } from "@/components/ui/modal";
import { OneTimeSecret } from "@/components/ui/secret";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/toolbar";
import { personName } from "@/lib/queries";
import { useErrorText } from "@/lib/use-error-text";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { GuardianFormSchema, compact, type GuardianForm } from "./form-schemas";

export function GuardiansPage() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const list = useListState();
  const guardians = useQuery({
    queryKey: ["guardians", list.apiQuery],
    queryFn: () => api.get<Page<GuardianDto>>(`/guardians?${list.apiQuery}`),
  });
  const [editing, setEditing] = useState<GuardianDto | "new" | null>(null);
  return (
    <>
      <PageHeader
        title={t("guardians.title")}
        actions={
          can(me.data, "guardians.manage") && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden />
              {t("guardians.add")}
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput label={t("guardians.search")} value={list.q} onChange={(q) => list.update({ q })} />
        </Toolbar>
        <QueryBoundary
          query={guardians}
          isEmpty={(p) => p.total === 0}
          empty={<EmptyState text={list.q ? t("list.noMatches") : t("guardians.empty")} />}
        >
          {(p) => (
            <>
              <DataTable
                rows={p.items}
                onRowClick={can(me.data, "guardians.manage") ? (g) => setEditing(g) : undefined}
                columns={[
                  { key: "name", header: t("students.name"), primary: true, cell: (g) => personName(g) },
                  { key: "phone", header: t("people.phone"), cell: (g) => <span className="tabular">{g.phone}</span> },
                  {
                    key: "children",
                    header: t("guardians.children"),
                    cell: (g) => g.children.map((c) => `${c.lastName} ${c.firstName}`).join(", ") || "—",
                  },
                  {
                    key: "account",
                    header: t("students.account"),
                    cell: (g) => (g.hasAccount ? t("common.yes") : t("common.no")),
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
      {editing && <GuardianDrawer guardian={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function GuardianDrawer({ guardian, onClose }: { guardian: GuardianDto | null; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useMe();
  const [secret, setSecret] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const form = useZodForm(
    GuardianFormSchema,
    guardian
      ? {
          lastName: guardian.lastName,
          firstName: guardian.firstName,
          middleName: guardian.middleName ?? undefined,
          phone: guardian.phone,
          notes: guardian.notes ?? undefined,
        }
      : undefined,
  );
  const save = useMutation({
    mutationFn: (v: GuardianForm) =>
      guardian ? api.patch(`/guardians/${guardian.id}`, compact(v)) : api.post("/guardians", compact(v)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["guardians"] });
      toast("success", t("common.saved"));
      onClose();
    },
    onError: (err) => applyServerErrors(form, err) || toast("error", errorText(err)),
  });
  const account = useMutation({
    mutationFn: () => api.post<{ username: string; temporaryPassword: string }>(`/guardians/${guardian!.id}/account`),
    onSuccess: (acc) => {
      setSecret(acc);
      void qc.invalidateQueries({ queryKey: ["guardians"] });
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
  return (
    <FormDrawer
      title={guardian ? personName(guardian) : t("guardians.add")}
      formId="guardian-form"
      busy={save.isPending}
      onClose={onClose}
    >
      <form id="guardian-form" className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <TextField form={form} name="lastName" label={t("people.lastName")} />
        <TextField form={form} name="firstName" label={t("people.firstName")} />
        <TextField form={form} name="middleName" label={t("people.middleName")} />
        <TextField form={form} name="phone" type="tel" label={t("people.phone")} hint={t("guardians.phoneHint")} />
        <TextField form={form} name="notes" label={t("people.notes")} />
      </form>
      {guardian && !guardian.hasAccount && can(me.data, "users.manage") && (
        <Button
          variant="secondary"
          className="mt-6 w-full"
          loading={account.isPending}
          onClick={() => account.mutate()}
        >
          <KeyRound className="size-4" aria-hidden />
          {t("accounts.create")}
        </Button>
      )}
    </FormDrawer>
  );
}
