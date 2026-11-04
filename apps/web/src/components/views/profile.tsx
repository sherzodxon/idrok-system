"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, Smartphone } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import type { Session } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useLogout } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { LoadingState, QueryBoundary, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useErrorText } from "@/lib/use-error-text";
import { ME_KEY, useMe } from "@/lib/use-me";
import { ChangePasswordForm } from "./change-password-form";

export function ProfileView() {
  const t = useTranslations();
  const format = useFormatter();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const errorText = useErrorText();
  const logout = useLogout();
  const me = useMe();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<Session[]>("/auth/sessions") });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (err) => toast("error", errorText(err)),
    onSettled: () => setRevoking(null),
  });
  const density = useMutation({
    mutationFn: (value: "COMFORTABLE" | "COMPACT") => api.patch("/me/preferences", { density: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
    onError: (err) => toast("error", errorText(err)),
  });

  if (me.isPending) return <LoadingState />;
  if (!me.data) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const user = me.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-foreground">{t("profile.title")}</h1>
      <Card>
        <CardHeader title={t("profile.account")} />
        <div className="flex flex-col gap-3 p-5">
          <p className="text-lg font-semibold">{user.displayName}</p>
          <p className="text-sm text-muted">{user.username}</p>
          <div className="flex flex-wrap gap-2">
            {user.roles.map((r) => (
              <Badge key={r} tone="primary">
                {t.has(`roles.${r}`) ? t(`roles.${r}`) : r}
              </Badge>
            ))}
          </div>
          <div>
            <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
              {t("profile.changePassword")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("profile.preferences")} />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("shell.theme")}</span>
            <ThemeToggle initial={user.preferences.themeMode} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("shell.language")}</span>
            <LocaleSwitcher />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("profile.density")}</span>
            <Select
              value={user.preferences.density}
              onChange={(e) => density.mutate(e.target.value as "COMFORTABLE" | "COMPACT")}
            >
              <option value="COMFORTABLE">{t("profile.densityComfortable")}</option>
              <option value="COMPACT">{t("profile.densityCompact")}</option>
            </Select>
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("profile.sessions")}
          action={
            <Button variant="ghost" size="sm" onClick={() => setConfirmAll(true)}>
              {t("profile.logoutAll")}
            </Button>
          }
        />
        <QueryBoundary query={sessions}>
          {(list) => (
            <ul className="divide-y divide-border">
              {list.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  {s.clientType === "WEB" ? (
                    <Laptop className="size-5 text-muted" aria-hidden />
                  ) : (
                    <Smartphone className="size-5 text-muted" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {t(`profile.clientTypes.${s.clientType}`)}{" "}
                      {s.current && <Badge tone="success">{t("profile.sessionCurrent")}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {t("profile.sessionStarted", {
                        date: format.dateTime(new Date(s.createdAt), { dateStyle: "medium", timeStyle: "short" }),
                      })}
                    </p>
                  </div>
                  {!s.current && (
                    <Button variant="ghost" size="sm" onClick={() => setRevoking(s.id)}>
                      {t("profile.revoke")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>

      <ConfirmDialog
        open={!!revoking}
        title={t("profile.revoke")}
        text={t("profile.revokeConfirm")}
        loading={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
      <ConfirmDialog
        open={confirmAll}
        danger
        title={t("profile.logoutAll")}
        text={t("profile.logoutAllConfirm")}
        onCancel={() => setConfirmAll(false)}
        onConfirm={async () => {
          await api.post("/auth/logout-all").catch(() => {});
          await logout();
        }}
      />
      <Modal open={passwordOpen} onClose={() => setPasswordOpen(false)} title={t("profile.changePassword")}>
        <ChangePasswordForm
          onDone={() => {
            setPasswordOpen(false);
            toast("success", t("auth.passwordChanged"));
            void qc.invalidateQueries({ queryKey: ["sessions"] });
          }}
        />
      </Modal>
    </div>
  );
}
