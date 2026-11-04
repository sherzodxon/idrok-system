"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  PERMISSIONS,
  deriveBrandShades,
  isHexColor,
  type AuditLogEntry,
  type Branding,
  type Page,
  type RoleDto,
  type SchoolSettingsDto,
  type UserListItem,
} from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { OneTimeSecret } from "@/components/ui/secret";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { FilterSelect, PageHeader, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { useRoles } from "@/lib/queries";
import { useErrorText } from "@/lib/use-error-text";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";

type Tab = "school" | "branding" | "users" | "roles" | "audit";

function useSave<T, R = unknown>(fn: (body: T) => Promise<R>, invalidate: string[], onDone?: (r: R) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useTranslations("common");
  const errorText = useErrorText();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: [key] });
      toast("success", t("saved"));
      onDone?.(r);
    },
    onError: (err) => toast("error", errorText(err)),
  });
}

export function SettingsPage() {
  const t = useTranslations("settings");
  const me = useMe();
  const list = useListState(["tab"] as const);
  const tabs = (
    [
      { value: "school", label: t("school"), permission: "settings.view" },
      { value: "branding", label: t("branding"), permission: "settings.view" },
      { value: "users", label: t("users"), permission: "users.view" },
      { value: "roles", label: t("roles"), permission: "roles.view" },
      { value: "audit", label: t("audit"), permission: "audit_logs.view" },
    ] as const
  ).filter((x) => can(me.data, x.permission));
  const tab = (tabs.find((x) => x.value === list.filters.tab)?.value ?? tabs[0]?.value ?? "school") as Tab;
  return (
    <>
      <PageHeader title={t("title")} />
      <Tabs<Tab>
        value={tab}
        onChange={(v) => list.update({ tab: v })}
        tabs={tabs.map(({ value, label }) => ({ value, label }))}
      />
      {tab === "school" && <SchoolTab />}
      {tab === "branding" && <BrandingTab />}
      {tab === "users" && <UsersTab />}
      {tab === "roles" && <RolesTab />}
      {tab === "audit" && <AuditTab />}
    </>
  );
}

// ---------------------------------------------------------------- school

function SchoolTab() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const settings = useQuery({
    queryKey: ["settings-school"],
    queryFn: () => api.get<SchoolSettingsDto>("/settings/school"),
  });
  const [draft, setDraft] = useState<SchoolSettingsDto | null>(null);
  const value = draft ?? settings.data;
  const save = useSave(
    (body: SchoolSettingsDto) => api.put("/settings/school", body),
    ["settings-school"],
    () => setDraft(null),
  );
  const manage = can(me.data, "settings.manage");
  const set = (patch: Partial<SchoolSettingsDto>) => value && setDraft({ ...value, ...patch });
  return (
    <Card className="max-w-2xl">
      <QueryBoundary query={settings}>
        {() =>
          value && (
            <form
              className="flex flex-col gap-4 p-5"
              onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(value))}
            >
              <Field label={t("settings.timezone")}>
                {(id) => (
                  <Input
                    id={id}
                    disabled={!manage}
                    value={value.timezone}
                    onChange={(e) => set({ timezone: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("settings.defaultLocale")}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={!manage}
                    value={value.defaultLocale}
                    onChange={(e) => set({ defaultLocale: e.target.value as "uz" | "ru" })}
                  >
                    <option value="uz">{t("locales.uz")}</option>
                    <option value="ru">{t("locales.ru")}</option>
                  </Select>
                )}
              </Field>
              <Field label={t("settings.minGrade")} hint={t("settings.minGradeHint")}>
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    disabled={!manage}
                    type="number"
                    min={0}
                    max={11}
                    value={value.studentAccountMinGrade}
                    onChange={(e) => set({ studentAccountMinGrade: Number(e.target.value) })}
                  />
                )}
              </Field>
              <Field label={t("settings.weekStartsOn")}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={!manage}
                    value={value.weekStartsOn}
                    onChange={(e) => set({ weekStartsOn: Number(e.target.value) })}
                  >
                    {[1, 7].map((d) => (
                      <option key={d} value={d}>
                        {t(`settings.weekdays.${d}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("settings.maxQuestions")} hint={t("settings.maxQuestionsHint")}>
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    disabled={!manage}
                    type="number"
                    min={1}
                    max={200}
                    value={value.maxQuestionsPerTest}
                    onChange={(e) => set({ maxQuestionsPerTest: Number(e.target.value) })}
                  />
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!manage}
                  checked={value.planApprovalRequired}
                  onChange={(e) => set({ planApprovalRequired: e.target.checked })}
                />
                {t("settings.planApproval")}
              </label>
              {manage && (
                <div>
                  <Button type="submit" loading={save.isPending} disabled={!draft}>
                    {t("common.save")}
                  </Button>
                </div>
              )}
            </form>
          )
        }
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- branding

const BRAND_VARS = {
  primaryColor: "--brand-primary",
  primaryHoverColor: "--brand-primary-hover",
  primaryStrongColor: "--brand-primary-strong",
  primarySoftColor: "--brand-primary-soft",
} as const;

function BrandingTab() {
  const t = useTranslations();
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const me = useMe();
  const branding = useQuery({
    queryKey: ["settings-branding"],
    queryFn: () => api.get<Branding>("/settings/branding"),
  });
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [platformName, setPlatformName] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [theme, setTheme] = useState<Branding["defaultThemeMode"] | null>(null);
  const manage = can(me.data, "branding.manage");
  const current = branding.data;
  const primary = color ?? current?.primaryColor ?? "";

  // Live preview: the whole page takes the new colour before it is saved.
  useEffect(() => {
    if (!color || !isHexColor(color)) return;
    const shades = { primaryColor: color, ...deriveBrandShades(color) };
    const root = document.documentElement;
    for (const [k, v] of Object.entries(BRAND_VARS)) root.style.setProperty(v, shades[k as keyof typeof shades]);
  }, [color]);

  const save = useSave(
    () =>
      api.put<{ warnings: { code: string }[] }>("/settings/branding", {
        ...(schoolName !== null ? { schoolName } : {}),
        ...(platformName !== null ? { platformName } : {}),
        ...(color !== null ? { primaryColor: color } : {}),
        ...(theme !== null ? { defaultThemeMode: theme } : {}),
      }),
    ["settings-branding"],
    (r) => {
      for (const w of r.warnings) toast("error", t(`settings.warnings.${w.code}`));
      router.refresh();
    },
  );
  return (
    <Card className="max-w-2xl">
      <QueryBoundary query={branding}>
        {(b) => (
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
          >
            <Field label={t("settings.schoolName")}>
              {(id) => (
                <Input
                  id={id}
                  disabled={!manage}
                  required
                  value={schoolName ?? b.schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                />
              )}
            </Field>
            <Field label={t("settings.platformName")}>
              {(id) => (
                <Input
                  id={id}
                  disabled={!manage}
                  required
                  value={platformName ?? b.platformName}
                  onChange={(e) => setPlatformName(e.target.value)}
                />
              )}
            </Field>
            <Field label={t("settings.primaryColor")} hint={t("settings.primaryColorHint")}>
              {(id, d) => (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    aria-label={t("settings.primaryColor")}
                    disabled={!manage}
                    value={isHexColor(primary) ? primary.toLowerCase() : undefined}
                    onChange={(e) => setColor(e.target.value.toUpperCase())}
                    className="h-10 w-14 cursor-pointer rounded-input border border-border bg-surface"
                  />
                  <Input
                    id={id}
                    aria-describedby={d}
                    disabled={!manage}
                    value={primary}
                    pattern="#[0-9A-Fa-f]{6}"
                    onChange={(e) => setColor(e.target.value.toUpperCase())}
                    className="w-32 font-mono"
                    data-testid="brand-color"
                  />
                </div>
              )}
            </Field>
            <Field label={t("settings.defaultTheme")}>
              {(id) => (
                <Select
                  id={id}
                  disabled={!manage}
                  value={theme ?? b.defaultThemeMode}
                  onChange={(e) => setTheme(e.target.value as Branding["defaultThemeMode"])}
                >
                  {(["SYSTEM", "LIGHT", "DARK"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(m === "SYSTEM" ? "shell.themeSystem" : m === "LIGHT" ? "shell.themeLight" : "shell.themeDark")}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-border p-4">
              <span className="text-sm text-muted">{t("settings.preview")}</span>
              <Button size="sm">{t("common.save")}</Button>
              <Badge tone="primary">{b.schoolName}</Badge>
            </div>
            {manage && (
              <div>
                <Button
                  type="submit"
                  loading={save.isPending}
                  disabled={color !== null && !isHexColor(color)}
                  data-testid="brand-save"
                >
                  {t("common.save")}
                </Button>
              </div>
            )}
          </form>
        )}
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- users

function UsersTab() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const format = useFormatter();
  const list = useListState(["roleCode", "status"] as const);
  const roles = useRoles();
  const users = useQuery({
    queryKey: ["users", list.apiQuery],
    queryFn: () => api.get<Page<UserListItem>>(`/users?${list.apiQuery}`),
  });
  const [selected, setSelected] = useState<UserListItem | null>(null);
  const roleLabel = (code: string) =>
    t.has(`roles.${code}`) ? t(`roles.${code}`) : (roles.data?.find((r) => r.code === code)?.name ?? code);
  return (
    <Card>
      <Toolbar>
        <SearchInput label={t("users.search")} value={list.q} onChange={(q) => list.update({ q })} />
        <FilterSelect
          label={t("users.role")}
          allLabel={t("users.allRoles")}
          value={list.filters.roleCode}
          onChange={(v) => list.update({ roleCode: v })}
          options={(roles.data ?? []).map((r) => ({ value: r.code, label: roleLabel(r.code) }))}
        />
        <FilterSelect
          label={t("students.statusLabel")}
          allLabel={t("list.allStatuses")}
          value={list.filters.status}
          onChange={(v) => list.update({ status: v })}
          options={(["ACTIVE", "DISABLED"] as const).map((s) => ({ value: s, label: t(`users.status.${s}`) }))}
        />
      </Toolbar>
      <QueryBoundary query={users} isEmpty={(p) => p.total === 0} empty={<EmptyState text={t("list.noMatches")} />}>
        {(p) => (
          <>
            <DataTable
              testId="users-table"
              rows={p.items}
              onRowClick={can(me.data, "users.manage") || can(me.data, "roles.assign") ? setSelected : undefined}
              columns={[
                {
                  key: "username",
                  header: t("accounts.username"),
                  primary: true,
                  cell: (u) => <span className="font-mono text-sm">{u.username}</span>,
                },
                { key: "roles", header: t("users.role"), cell: (u) => u.roles.map(roleLabel).join(", ") || "—" },
                {
                  key: "status",
                  header: t("students.statusLabel"),
                  cell: (u) => (
                    <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{t(`users.status.${u.status}`)}</Badge>
                  ),
                },
                {
                  key: "last",
                  header: t("users.lastLogin"),
                  cell: (u) =>
                    u.lastLoginAt
                      ? format.dateTime(new Date(u.lastLoginAt), { dateStyle: "short", timeStyle: "short" })
                      : "—",
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
      {selected && <UserDrawer user={selected} onClose={() => setSelected(null)} />}
    </Card>
  );
}

function UserDrawer({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const roles = useRoles();
  const [roleIds, setRoleIds] = useState<string[] | null>(null);
  const [secret, setSecret] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "toggle" | null>(null);
  const current = roleIds ?? (roles.data ?? []).filter((r) => user.roles.includes(r.code)).map((r) => r.id);
  const saveRoles = useSave(() => api.put(`/users/${user.id}/roles`, { roleIds: current }), ["users"], onClose);
  const reset = useSave(
    () => api.post<{ username: string; temporaryPassword: string }>(`/users/${user.id}/reset-password`),
    ["users"],
    (r) => (setConfirm(null), setSecret(r)),
  );
  const toggle = useSave(
    () => api.post(`/users/${user.id}/${user.status === "ACTIVE" ? "disable" : "enable"}`),
    ["users"],
    onClose,
  );
  if (secret) {
    return (
      <Modal open onClose={onClose} title={t("users.passwordReset")}>
        <OneTimeSecret username={secret.username} password={secret.temporaryPassword} />
      </Modal>
    );
  }
  return (
    <FormDrawer title={user.username} formId="user-roles" busy={saveRoles.isPending} onClose={onClose}>
      <form
        id="user-roles"
        className="flex flex-col gap-2"
        onSubmit={(e: FormEvent) => (e.preventDefault(), saveRoles.mutate(undefined))}
      >
        <p className="text-sm font-medium">{t("users.role")}</p>
        {(roles.data ?? []).map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!can(me.data, "roles.assign")}
              checked={current.includes(r.id)}
              onChange={(e) => setRoleIds(e.target.checked ? [...current, r.id] : current.filter((x) => x !== r.id))}
            />
            {t.has(`roles.${r.code}`) ? t(`roles.${r.code}`) : r.name}
          </label>
        ))}
      </form>
      {can(me.data, "users.manage") && (
        <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={() => setConfirm("reset")}>
            {t("users.resetPassword")}
          </Button>
          <Button
            variant={user.status === "ACTIVE" ? "danger" : "secondary"}
            onClick={() => setConfirm("toggle")}
            disabled={user.id === me.data?.id}
          >
            {t(user.status === "ACTIVE" ? "users.disable" : "users.enable")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm === "reset"}
        title={t("users.resetPassword")}
        text={t("users.resetConfirm")}
        loading={reset.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => reset.mutate(undefined)}
      />
      <ConfirmDialog
        open={confirm === "toggle"}
        danger={user.status === "ACTIVE"}
        title={t(user.status === "ACTIVE" ? "users.disable" : "users.enable")}
        text={t(user.status === "ACTIVE" ? "users.disableConfirm" : "users.enableConfirm")}
        loading={toggle.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => toggle.mutate(undefined)}
      />
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- roles (permission matrix editor)

function RolesTab() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const roles = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const manage = can(me.data, "roles.manage");
  const role = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0];
  const checked = draft ?? role?.permissions ?? [];
  const modules = useMemo(() => [...new Set(PERMISSIONS.map((p) => p.module))], []);
  const save = useSave(
    () => api.put<RoleDto>(`/roles/${role!.id}/permissions`, { permissions: checked }),
    ["roles"],
    () => setDraft(null),
  );
  const archive = useSave(
    () => api.post(`/roles/${role!.id}/archive`),
    ["roles"],
    () => (setArchiving(false), setSelectedId(null)),
  );
  const label = (r: RoleDto) => (t.has(`roles.${r.code}`) ? t(`roles.${r.code}`) : r.name);
  return (
    <QueryBoundary query={roles}>
      {(list) => (
        <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
          <Card className="p-2">
            <ul className="flex flex-col gap-1">
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => (setSelectedId(r.id), setDraft(null))}
                    className={cn(
                      "flex w-full items-center justify-between rounded-button px-3 py-2 text-left text-sm hover:bg-surface-muted",
                      r.id === role?.id && "bg-primary-soft text-primary-strong",
                    )}
                  >
                    {label(r)}
                    {!r.isSystem && <Badge>{t("roleEditor.custom")}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
            {manage && (
              <Button variant="ghost" className="mt-2 w-full" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                {t("roleEditor.add")}
              </Button>
            )}
          </Card>
          {role && (
            <Card>
              <CardHeader
                title={label(role)}
                action={
                  manage && (
                    <div className="flex gap-2">
                      {!role.isSystem && (
                        <Button variant="ghost" size="sm" onClick={() => setArchiving(true)}>
                          {t("roleEditor.archive")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={!draft}
                        loading={save.isPending}
                        onClick={() => save.mutate(undefined)}
                        data-testid="role-save"
                      >
                        {t("common.save")}
                      </Button>
                    </div>
                  )
                }
              />
              <div className="grid gap-5 p-5 sm:grid-cols-2">
                {modules.map((m) => (
                  <fieldset key={m} className="flex min-w-0 flex-col gap-1.5">
                    <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                      {t(`permissions.modules.${m}`)}
                    </legend>
                    {PERMISSIONS.filter((p) => p.module === m).map((p) => (
                      <label key={p.code} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          disabled={!manage}
                          checked={checked.includes(p.code)}
                          onChange={(e) =>
                            setDraft(e.target.checked ? [...checked, p.code] : checked.filter((c) => c !== p.code))
                          }
                        />
                        <span className="min-w-0 break-words">
                          {t(`permissions.codes.${p.code.replaceAll(".", "_")}`)}
                          <span className="block break-all font-mono text-xs text-disabled">{p.code}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            </Card>
          )}
          {creating && <CreateRoleDrawer onClose={() => setCreating(false)} />}
          <ConfirmDialog
            open={archiving}
            danger
            title={t("roleEditor.archive")}
            text={t("roleEditor.archiveConfirm")}
            loading={archive.isPending}
            onCancel={() => setArchiving(false)}
            onConfirm={() => archive.mutate(undefined)}
          />
        </div>
      )}
    </QueryBoundary>
  );
}

function CreateRoleDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("roleEditor");
  const api = useApi();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const save = useSave(() => api.post("/roles", { code, name, permissions: [] }), ["roles"], onClose);
  return (
    <FormDrawer title={t("add")} formId="role-form" busy={save.isPending} onClose={onClose}>
      <form
        id="role-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("name")}>
          {(id) => <Input id={id} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t("code")} hint={t("codeHint")}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              required
              pattern="[A-Z][A-Z0-9_]{1,39}"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              className="font-mono"
            />
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- audit log

function AuditTab() {
  const t = useTranslations();
  const api = useApi();
  const format = useFormatter();
  const list = useListState(["entityType", "from", "to"] as const);
  const audit = useQuery({
    queryKey: ["audit", list.apiQuery],
    queryFn: () => api.get<Page<AuditLogEntry>>(`/audit-logs?${list.apiQuery}`),
  });
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  const ENTITY_TYPES = [
    "User",
    "Role",
    "Student",
    "Guardian",
    "Employee",
    "ClassGroup",
    "AcademicYear",
    "TeacherAssignment",
    "ImportJob",
    "SchoolBranding",
    "SchoolSettings",
    "AuthSession",
  ];
  return (
    <Card>
      <Toolbar>
        <FilterSelect
          label={t("audit.entity")}
          allLabel={t("audit.allEntities")}
          value={list.filters.entityType}
          onChange={(v) => list.update({ entityType: v })}
          options={ENTITY_TYPES.map((e) => ({ value: e, label: e }))}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          {t("audit.from")}
          <Input
            type="date"
            value={list.filters.from}
            onChange={(e) => list.update({ from: e.target.value })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          {t("audit.to")}
          <Input
            type="date"
            value={list.filters.to}
            onChange={(e) => list.update({ to: e.target.value })}
            className="w-40"
          />
        </label>
      </Toolbar>
      <QueryBoundary query={audit} isEmpty={(p) => p.total === 0} empty={<EmptyState text={t("audit.empty")} />}>
        {(p) => (
          <>
            <DataTable
              rows={p.items}
              onRowClick={setOpen}
              columns={[
                {
                  key: "time",
                  header: t("common.date"),
                  cell: (e) => (
                    <span className="tabular">
                      {format.dateTime(new Date(e.createdAt), { dateStyle: "short", timeStyle: "medium" })}
                    </span>
                  ),
                },
                {
                  key: "action",
                  header: t("audit.action"),
                  primary: true,
                  cell: (e) => <span className="font-mono text-sm">{e.action}</span>,
                },
                { key: "entity", header: t("audit.entity"), cell: (e) => e.entityType },
                { key: "actor", header: t("audit.actor"), cell: (e) => e.actor?.username ?? t("audit.system") },
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
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ""}>
        {open && (
          <div className="flex flex-col gap-3 text-sm">
            {open.reason && <p>{open.reason}</p>}
            {(["before", "after"] as const).map((k) =>
              open[k] ? (
                <div key={k}>
                  <p className="mb-1 font-medium">{t(`audit.${k}`)}</p>
                  <pre className="max-h-64 overflow-auto rounded-button bg-surface-muted p-3 text-xs">
                    {JSON.stringify(open[k], null, 2)}
                  </pre>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
