"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Me, PermissionCode } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";

export const ME_KEY = ["me"] as const;

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ME_KEY, queryFn: () => api.get<Me>("/me") });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: Me) => qc.setQueryData(ME_KEY, me);
}

export const can = (me: Me | undefined, permission: PermissionCode) => !!me?.permissions.includes(permission);

const PORTAL_ONLY = new Set(["STUDENT", "GUARDIAN"]);
/** Students and guardians use the mobile-first portal; everyone else the app shell. */
export const isPortalUser = (me: Me) => me.roles.length > 0 && me.roles.every((r) => PORTAL_ONLY.has(r));
export const homePath = (me: Me) =>
  me.mustChangePassword ? "/change-password" : isPortalUser(me) ? "/home" : "/dashboard";
