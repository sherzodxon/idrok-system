"use client";

// List state lives in the URL (?page=&pageSize=&q=&sort=&<filters>) so a reload or a shared link keeps it
// (EdexTest/Registo lesson; ui-structure.md §7).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export function useListState<F extends string>(filterKeys: readonly F[] = []) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state = useMemo(() => {
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const pageSize = [10, 20, 50, 100].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 20;
    const filters = Object.fromEntries(filterKeys.map((k) => [k, params.get(k) ?? ""])) as Record<F, string>;
    return { page, pageSize, q: params.get("q") ?? "", sort: params.get("sort") ?? "", filters };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKeys is a constant list
  }, [params]);

  const update = useCallback(
    (patch: Record<string, string | number | undefined>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  /** Query string for the API list endpoint. */
  const apiQuery = useMemo(() => {
    const q = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
    if (state.q) q.set("q", state.q);
    if (state.sort) q.set("sort", state.sort);
    for (const [k, v] of Object.entries(state.filters)) if (v) q.set(k, v as string);
    return q.toString();
  }, [state]);

  return { ...state, update, apiQuery };
}
