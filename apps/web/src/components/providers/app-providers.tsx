"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ApiError, createApiClient, readBrowserCookie, type ApiClient } from "@/lib/api-client";
import { ToastProvider } from "@/components/ui/toast";

const ApiContext = createContext<ApiClient | null>(null);
const ApiUrlContext = createContext("");

/** API base URL for plain links (template downloads use the session cookie). */
export const useApiUrl = () => useContext(ApiUrlContext);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi outside AppProviders");
  return api;
}

export function AppProviders({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const router = useRouter();
  const [api] = useState(() =>
    createApiClient({
      baseUrl: apiUrl,
      fetch: (...args) => fetch(...args),
      readCookie: readBrowserCookie,
      onSessionLost: () => router.replace("/login"),
    }),
  );
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Auth and permission errors are final; network blips get one retry.
            retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
          },
        },
      }),
  );
  return (
    <ApiUrlContext.Provider value={apiUrl}>
      <ApiContext.Provider value={api}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </ApiContext.Provider>
    </ApiUrlContext.Provider>
  );
}
