"use client";

// One login account (Sozlamalar → Foydalanuvchilar → user): the card it belongs to, login name, roles, security
// actions, open sessions, activity of the last 30 days and the audit trail of what the user did. And the
// "new user" drawer: an account is always made for a card (employee, student, guardian) — an existing card without a
// login, or a new one — so names live on the card.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, LogOut, Pencil, UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { AccountCreated, AuditLogEntry, ClassGroupDto, Page, RoleDto, UserDetailDto } from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { OneTimeSecret } from "@/components/ui/secret";
import { StatCard } from "@/components/ui/stats";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { PageHeader, SearchInput } from "@/components/ui/toolbar";
import { formatDateTime } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import { useActiveYear, useClassGroups, useRoles } from "@/lib/queries";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";

const KEYS = ["user", "users"];

function useRoleLabel() {
  const t = useTranslations();
  const roles = useRoles();
  return (code: string, name?: string) =>
    t.has(`roles.${code}`) ? t(`roles.${code}`) : (name ?? roles.data?.find((r) => r.code === code)?.name ?? code);
}

export function UserPage({ id }: { id: string }) {
  const t = useTranslations("userPage");
  const api = useApi();
  const user = useQuery({ queryKey: ["user", id], queryFn: () => api.get<UserDetailDto>(`/users/${id}`) });
  return (
    <>
      <Link
        href="/admin/settings?tab=users"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <QueryBoundary query={user}>
        {(u) => (
          <>
            <PageHeader title={u.displayName} subtitle={u.username} />
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="flex flex-col gap-4 lg:col-span-2">
                <AccountCard user={u} />
                <ActivityCard user={u} />
                <AuditCard userId={u.id} />
              </div>
              <div className="flex flex-col gap-4">
                <RolesCard user={u} />
                <SecurityCard user={u} />
              </div>
            </div>
          </>
        )}
      </QueryBoundary>
    </>
  );
}

const personHref = (p: NonNullable<UserDetailDto["person"]>) =>
  p.kind === "STUDENT" ? `/admin/students/${p.id}` : p.kind === "EMPLOYEE" ? "/admin/employees" : "/admin/guardians";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function AccountCard({ user }: { user: UserDetailDto }) {
  const t = useTranslations("userPage");
  const me = useMe();
  const manage = can(me.data, "users.manage");
  const [renaming, setRenaming] = useState(false);
  const [linking, setLinking] = useState(false);
  const when = (iso: string | null) => formatDateTime(iso);
  return (
    <Card>
      <CardHeader title={t("account")} />
      <dl className="flex flex-col gap-3 px-5 pb-5" data-testid="user-account">
        <Row label={t("person")}>
          {user.person ? (
            <Link
              href={personHref(user.person)}
              className="inline-flex items-center gap-2 text-primary hover:underline"
            >
              <UserRound className="size-4" aria-hidden />
              {`${user.person.lastName} ${user.person.firstName}`}
              <span className="text-muted">
                {t(`kinds.${user.person.kind}`)}
                {user.person.detail ? ` · ${user.person.detail}` : ""}
              </span>
            </Link>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-muted">{t("noPerson")}</span>
              {manage && (
                <Button size="sm" variant="secondary" onClick={() => setLinking(true)}>
                  {t("linkEmployee")}
                </Button>
              )}
            </span>
          )}
        </Row>
        <Row label={t("username")}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{user.username}</span>
            {manage && user.person?.kind !== "GUARDIAN" && (
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)} data-testid="change-username">
                <Pencil className="size-4" aria-hidden />
                {t("changeUsername")}
              </Button>
            )}
            {user.person?.kind === "GUARDIAN" && <span className="text-xs text-muted">{t("guardianLogin")}</span>}
          </span>
        </Row>
        <Row label={t("status")}>
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={user.status === "ACTIVE" ? "success" : "danger"}>{t(`statuses.${user.status}`)}</Badge>
            {user.mustChangePassword && <Badge tone="warning">{t("mustChangePassword")}</Badge>}
          </span>
        </Row>
        <Row label={t("lastLogin")}>{when(user.lastLoginAt)}</Row>
        <Row label={t("passwordChanged")}>{when(user.passwordChangedAt)}</Row>
        <Row label={t("created")}>{when(user.createdAt)}</Row>
      </dl>
      {renaming && <UsernameDialog user={user} onClose={() => setRenaming(false)} />}
      {linking && <LinkEmployeeDialog user={user} onClose={() => setLinking(false)} />}
    </Card>
  );
}

function UsernameDialog({ user, onClose }: { user: UserDetailDto; onClose: () => void }) {
  const t = useTranslations("userPage");
  const api = useApi();
  const me = useMe();
  const [username, setUsername] = useState(user.username);
  const self = me.data?.id === user.id;
  const save = useSave(
    () => api.put(`/users/${user.id}/username`, { username }),
    KEYS,
    () => {
      onClose();
      if (self) window.location.assign("/login");
    },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("changeUsername")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button form="username-form" type="submit" loading={save.isPending} data-testid="save-username">
            {t("save")}
          </Button>
        </>
      }
    >
      <form
        id="username-form"
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("newUsername")} hint={t("usernameHint")}>
          {(id) => (
            <Input
              id={id}
              required
              autoComplete="off"
              className="font-mono"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>
        <p className="rounded-button bg-warning-soft px-3 py-2 text-sm">
          {self ? t("selfRenameWarning") : t("renameWarning")}
        </p>
      </form>
    </Modal>
  );
}

function LinkEmployeeDialog({ user, onClose }: { user: UserDetailDto; onClose: () => void }) {
  const t = useTranslations("userPage");
  const api = useApi();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const save = useSave(
    () =>
      api.post(
        `/users/${user.id}/link-employee`,
        mode === "new" ? { newEmployee: { firstName, lastName } } : { employeeId: picked?.id },
      ),
    [...KEYS, "me"],
    onClose,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("linkEmployee")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button form="link-form" type="submit" loading={save.isPending} disabled={mode === "existing" && !picked}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form
        id="link-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <p className="text-sm text-muted">{t("linkHint")}</p>
        <ModeSwitch value={mode} onChange={setMode} />
        {mode === "new" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("lastName")}>
              {(id) => <Input id={id} required value={lastName} onChange={(e) => setLastName(e.target.value)} />}
            </Field>
            <Field label={t("firstName")}>
              {(id) => <Input id={id} required value={firstName} onChange={(e) => setFirstName(e.target.value)} />}
            </Field>
          </div>
        ) : (
          <CardPicker kind="EMPLOYEE" picked={picked} onPick={setPicked} />
        )}
      </form>
    </Modal>
  );
}

function ModeSwitch({ value, onChange }: { value: "new" | "existing"; onChange: (v: "new" | "existing") => void }) {
  const t = useTranslations("userPage");
  return (
    <div role="radiogroup" aria-label={t("mode")} className="grid grid-cols-2 gap-2">
      {(["new", "existing"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={
            value === m
              ? "h-10 rounded-control border border-primary bg-primary-soft text-sm font-medium text-primary-strong"
              : "h-10 rounded-control border border-border text-sm font-medium text-foreground hover:bg-surface-muted"
          }
        >
          {t(`modes.${m}`)}
        </button>
      ))}
    </div>
  );
}

type Kind = "EMPLOYEE" | "STUDENT" | "GUARDIAN";
const LIST_PATH: Record<Kind, string> = { EMPLOYEE: "/employees", STUDENT: "/students", GUARDIAN: "/guardians" };

/** Cards of a kind without a login, searched on the server. */
function CardPicker({
  kind,
  picked,
  onPick,
}: {
  kind: Kind;
  picked: { id: string; name: string } | null;
  onPick: (p: { id: string; name: string }) => void;
}) {
  const t = useTranslations("userPage");
  const api = useApi();
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ account: "without", pageSize: "20" });
  if (q) params.set("q", q);
  const list = useQuery({
    queryKey: ["cards-without-login", kind, params.toString()],
    queryFn: () =>
      api.get<Page<{ id: string; firstName: string; lastName: string; studentCode?: string; phone?: string | null }>>(
        `${LIST_PATH[kind]}?${params.toString()}`,
      ),
  });
  return (
    <div className="flex flex-col gap-2">
      <SearchInput value={q} onChange={setQ} label={t("searchCard")} />
      <QueryBoundary query={list} isEmpty={(l) => l.items.length === 0} empty={<EmptyState text={t("noCards")} />}>
        {(l) => (
          <ul
            role="listbox"
            aria-label={t("searchCard")}
            className="max-h-64 overflow-y-auto rounded-card border border-border"
            data-testid="card-picker"
          >
            {l.items.map((c) => {
              const name = `${c.lastName} ${c.firstName}`;
              const active = picked?.id === c.id;
              return (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={active}
                  onClick={() => onPick({ id: c.id, name })}
                  className={
                    active
                      ? "flex cursor-pointer items-center justify-between gap-2 bg-primary-soft px-3 py-2 text-sm font-medium text-primary-strong"
                      : "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-surface-muted"
                  }
                >
                  <span>{name}</span>
                  <span className="text-xs text-muted">{c.studentCode ?? c.phone ?? ""}</span>
                </li>
              );
            })}
          </ul>
        )}
      </QueryBoundary>
    </div>
  );
}

/**
 * Roles that make sense for the account's card: portal roles only for a student / guardian card (and only those
 * there), super admin only when the editor is one or the account already has it.
 */
function fitsCard(role: RoleDto, user: UserDetailDto, myRoles: string[]) {
  const has = user.roles.some((r) => r.id === role.id);
  if (has) return true;
  const kind = user.person?.kind;
  if (kind === "STUDENT") return role.code === "STUDENT";
  if (kind === "GUARDIAN") return role.code === "GUARDIAN";
  if (role.code === "STUDENT" || role.code === "GUARDIAN") return false;
  if (role.code === "SUPER_ADMIN") return myRoles.includes("SUPER_ADMIN");
  return true;
}

function RolesCard({ user }: { user: UserDetailDto }) {
  const t = useTranslations("userPage");
  const api = useApi();
  const me = useMe();
  const roles = useRoles();
  const label = useRoleLabel();
  const [draft, setDraft] = useState<string[] | null>(null);
  const current = draft ?? user.roles.map((r) => r.id);
  const editable = can(me.data, "roles.assign");
  const save = useSave(
    () => api.put(`/users/${user.id}/roles`, { roleIds: current }),
    KEYS,
    () => setDraft(null),
  );
  return (
    <Card>
      <CardHeader
        title={t("roles")}
        action={
          editable && draft ? (
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)} data-testid="save-roles">
              {t("save")}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-2 px-5 pb-5">
        {editable
          ? (roles.data ?? [])
              .filter((r) => fitsCard(r, user, me.data?.roles ?? []))
              .map((r: RoleDto) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={current.includes(r.id)}
                    onChange={(e) =>
                      setDraft(e.target.checked ? [...current, r.id] : current.filter((x) => x !== r.id))
                    }
                  />
                  {label(r.code, r.name)}
                </label>
              ))
          : user.roles.map((r) => <Badge key={r.id}>{label(r.code, r.name)}</Badge>)}
      </div>
    </Card>
  );
}

function SecurityCard({ user }: { user: UserDetailDto }) {
  const t = useTranslations("userPage");
  const api = useApi();
  const me = useMe();
  const manage = can(me.data, "users.manage");
  const self = me.data?.id === user.id;
  const [confirm, setConfirm] = useState<"reset" | "toggle" | "logout" | null>(null);
  const [secret, setSecret] = useState<AccountCreated | null>(null);
  const reset = useSave(() => api.post<AccountCreated>(`/users/${user.id}/reset-password`), KEYS);
  const toggle = useSave(
    () => api.post(`/users/${user.id}/${user.status === "ACTIVE" ? "disable" : "enable"}`),
    KEYS,
    () => setConfirm(null),
  );
  const logout = useSave(
    () => api.post(`/users/${user.id}/sessions/revoke`),
    KEYS,
    () => setConfirm(null),
  );
  return (
    <Card>
      <CardHeader title={t("security")} />
      <div className="flex flex-col gap-4 px-5 pb-5">
        {manage && (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => setConfirm("reset")}>
              <KeyRound className="size-4" aria-hidden />
              {t("resetPassword")}
            </Button>
            <Button variant="secondary" onClick={() => setConfirm("logout")} disabled={!user.sessions.length}>
              <LogOut className="size-4" aria-hidden />
              {t("logoutAll")}
            </Button>
            <Button
              variant={user.status === "ACTIVE" ? "danger" : "secondary"}
              onClick={() => setConfirm("toggle")}
              disabled={self}
            >
              {t(user.status === "ACTIVE" ? "disable" : "enable")}
            </Button>
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-medium">{t("sessions", { n: user.sessions.length })}</p>
          {user.sessions.length === 0 ? (
            <p className="text-sm text-muted">{t("noSessions")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="user-sessions">
              {user.sessions.map((s) => (
                <li key={s.id} className="rounded-button bg-surface-muted px-3 py-2 text-xs">
                  <span className="font-medium">{t(`clients.${s.clientType}`)}</span>
                  <span className="block text-muted">
                    {t("sessionUsed", {
                      at: formatDateTime(s.lastUsedAt),
                    })}
                  </span>
                  {s.userAgent && <span className="block truncate text-muted">{s.userAgent}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm === "reset"}
        title={t("resetPassword")}
        text={t("resetConfirm")}
        loading={reset.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: (r) => {
              setConfirm(null);
              setSecret(r as AccountCreated);
            },
          })
        }
      />
      <ConfirmDialog
        open={confirm === "logout"}
        title={t("logoutAll")}
        text={t("logoutConfirm")}
        loading={logout.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => logout.mutate(undefined)}
      />
      <ConfirmDialog
        open={confirm === "toggle"}
        danger={user.status === "ACTIVE"}
        title={t(user.status === "ACTIVE" ? "disable" : "enable")}
        text={t(user.status === "ACTIVE" ? "disableConfirm" : "enableConfirm")}
        loading={toggle.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => toggle.mutate(undefined)}
      />
      {secret && (
        <Modal open onClose={() => setSecret(null)} title={t("resetPassword")}>
          <OneTimeSecret username={secret.username} password={secret.temporaryPassword} />
        </Modal>
      )}
    </Card>
  );
}

function ActivityCard({ user }: { user: UserDetailDto }) {
  const t = useTranslations("userPage");
  const { stats } = user;
  const tiles: { label: string; value: string | number }[] = [
    { label: t("stats.auditActions"), value: stats.auditActions },
  ];
  if (stats.employee) {
    tiles.push(
      { label: t("stats.scoresGiven"), value: stats.employee.scoresGiven },
      { label: t("stats.coinEvaluations"), value: stats.employee.coinEvaluations },
      { label: t("stats.teachingGroups"), value: stats.employee.teachingGroups },
      { label: t("stats.testsTotal"), value: stats.employee.testsTotal },
      { label: t("stats.questionsTotal"), value: stats.employee.questionsTotal },
    );
  }
  if (stats.student) {
    const a = stats.student.attendance;
    tiles.push(
      { label: t("stats.testsFinished"), value: stats.student.testsFinished },
      {
        label: t("stats.averagePercent"),
        value: stats.student.averagePercent ? `${stats.student.averagePercent}%` : "—",
      },
      { label: t("stats.coinBalance"), value: stats.student.coinBalance },
      { label: t("stats.arrived"), value: (a.PRESENT ?? 0) + (a.LATE ?? 0) },
      { label: t("stats.late"), value: a.LATE ?? 0 },
    );
  }
  if (stats.guardian) tiles.push({ label: t("stats.children"), value: stats.guardian.children.length });
  return (
    <Card>
      <CardHeader title={t("activity")} />
      <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3" data-testid="user-stats">
        {tiles.map((x) => (
          <StatCard key={x.label} label={x.label} value={x.value} />
        ))}
      </div>
      {stats.guardian && stats.guardian.children.length > 0 && (
        <p className="px-5 pb-5 text-sm text-muted">
          {stats.guardian.children.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link href={`/admin/students/${c.id}`} className="text-primary hover:underline">
                {c.name}
              </Link>
            </span>
          ))}
        </p>
      )}
    </Card>
  );
}

function AuditCard({ userId }: { userId: string }) {
  const t = useTranslations("userPage");
  const api = useApi();
  const me = useMe();
  const allowed = can(me.data, "audit_logs.view");
  const audit = useQuery({
    queryKey: ["audit", "user", userId],
    queryFn: () => api.get<Page<AuditLogEntry>>(`/audit-logs?actorUserId=${userId}&pageSize=10`),
    enabled: allowed,
  });
  if (!allowed) return null;
  return (
    <Card>
      <CardHeader title={t("history")} />
      <QueryBoundary query={audit} isEmpty={(p) => p.total === 0} empty={<EmptyState text={t("noHistory")} />}>
        {(p) => (
          <DataTable
            testId="user-audit"
            rows={p.items}
            columns={[
              {
                key: "time",
                header: t("when"),
                cell: (e) => <span className="tabular">{formatDateTime(e.createdAt)}</span>,
              },
              {
                key: "action",
                header: t("action"),
                primary: true,
                cell: (e) => <span className="font-mono text-sm">{e.action}</span>,
              },
              { key: "entity", header: t("entity"), cell: (e) => e.entityType },
            ]}
          />
        )}
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- new user

export function NewUserDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("userPage");
  const api = useApi();
  const roles = useRoles();
  const label = useRoleLabel();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const [kind, setKind] = useState<Kind>("EMPLOYEE");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [p, setP] = useState({ firstName: "", lastName: "", phone: "", classGroupId: "" });
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [belowMinGrade, setBelowMinGrade] = useState(false);
  const [created, setCreated] = useState<AccountCreated | null>(null);
  const set = (patch: Partial<typeof p>) => setP((x) => ({ ...x, ...patch }));
  const save = useSave(async () => {
    let cardId = picked?.id;
    if (mode === "new") {
      const body =
        kind === "STUDENT"
          ? {
              firstName: p.firstName,
              lastName: p.lastName,
              ...(p.classGroupId ? { enrollment: { classGroupId: p.classGroupId, validFrom: schoolToday() } } : {}),
            }
          : kind === "GUARDIAN"
            ? { firstName: p.firstName, lastName: p.lastName, phone: p.phone }
            : { firstName: p.firstName, lastName: p.lastName, phone: p.phone || null };
      cardId = (await api.post<{ id: string }>(LIST_PATH[kind], body)).id;
      setMode("existing");
      setPicked({ id: cardId, name: `${p.lastName} ${p.firstName}` });
    }
    const account = await api.post<AccountCreated>(`${LIST_PATH[kind]}/${cardId}/account`, {
      ...(kind === "EMPLOYEE" && roleIds.length ? { roleIds } : {}),
      ...(kind === "STUDENT" && belowMinGrade ? { allowBelowMinGrade: true } : {}),
    });
    setCreated(account);
  }, ["users", "cards-without-login"]);
  const failedBelowMin = save.error instanceof ApiError && save.error.details?.reason === "STUDENT_BELOW_MIN_GRADE";
  if (created) {
    return (
      <Modal open onClose={onClose} title={t("createdTitle")}>
        <OneTimeSecret username={created.username} password={created.temporaryPassword} />
      </Modal>
    );
  }
  return (
    <FormDrawer
      title={t("newUser")}
      formId="new-user"
      busy={save.isPending}
      onClose={onClose}
      saveLabel={t("createLogin")}
    >
      <form
        id="new-user"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (mode === "existing" && !picked) return;
          save.mutate(undefined);
        }}
      >
        <Field label={t("kind")}>
          {(id) => (
            <Select
              id={id}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setPicked(null);
              }}
              data-testid="new-user-kind"
            >
              {(["EMPLOYEE", "STUDENT", "GUARDIAN"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ModeSwitch value={mode} onChange={(m) => (setMode(m), setPicked(null))} />
        {mode === "existing" ? (
          <CardPicker kind={kind} picked={picked} onPick={setPicked} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("lastName")}>
                {(id) => (
                  <Input id={id} required value={p.lastName} onChange={(e) => set({ lastName: e.target.value })} />
                )}
              </Field>
              <Field label={t("firstName")}>
                {(id) => (
                  <Input id={id} required value={p.firstName} onChange={(e) => set({ firstName: e.target.value })} />
                )}
              </Field>
            </div>
            {kind !== "STUDENT" && (
              <Field label={t("phone")} hint={kind === "GUARDIAN" ? t("guardianPhoneHint") : undefined}>
                {(id) => (
                  <Input
                    id={id}
                    type="tel"
                    required={kind === "GUARDIAN"}
                    value={p.phone}
                    onChange={(e) => set({ phone: e.target.value })}
                  />
                )}
              </Field>
            )}
            {kind === "STUDENT" && (
              <Field label={t("classGroup")}>
                {(id) => (
                  <Select id={id} value={p.classGroupId} onChange={(e) => set({ classGroupId: e.target.value })}>
                    <option value="">—</option>
                    {(classes.data ?? []).map((c: ClassGroupDto) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </>
        )}
        {kind === "EMPLOYEE" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("roles")}</legend>
            {(roles.data ?? [])
              .filter((r) => !["STUDENT", "GUARDIAN", "SUPER_ADMIN"].includes(r.code))
              .map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={roleIds.includes(r.id)}
                    onChange={(e) => setRoleIds((x) => (e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id)))}
                  />
                  {label(r.code, r.name)}
                </label>
              ))}
            <p className="text-xs text-muted">{t("defaultRole")}</p>
          </fieldset>
        )}
        {kind === "STUDENT" && failedBelowMin && (
          <label className="flex items-start gap-2 rounded-button bg-warning-soft px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={belowMinGrade}
              onChange={(e) => setBelowMinGrade(e.target.checked)}
            />
            {t("belowMinGrade")}
          </label>
        )}
        {mode === "existing" && !picked && <p className="text-sm text-muted">{t("pickCard")}</p>}
        <p className="text-xs text-muted">{t(`loginRule.${kind}`)}</p>
      </form>
    </FormDrawer>
  );
}
