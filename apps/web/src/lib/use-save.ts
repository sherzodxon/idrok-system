"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useErrorText } from "./use-error-text";

/** Shared mutation plumbing: invalidate the given query keys, toast, then `onDone`. */
export function useSave<T>(fn: (body: T) => Promise<unknown>, invalidate: string[], onDone?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useTranslations("common");
  const errorText = useErrorText();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: [key] });
      toast("success", t("saved"));
      onDone?.();
    },
    onError: (err) => toast("error", errorText(err)),
  });
}
