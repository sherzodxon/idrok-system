"use client";

// React Hook Form + zod (CLAUDE.md §3). Server validation errors (VALIDATION_ERROR details.fields) map onto fields.
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { ApiError } from "@/lib/api-client";
import { Field, Input } from "./field";

export function useZodForm<TIn extends FieldValues, TOut extends FieldValues>(
  schema: z.ZodType<TOut, TIn>,
  defaultValues?: DefaultValues<TIn>,
) {
  return useForm<TIn, unknown, TOut>({ resolver: zodResolver(schema), defaultValues, mode: "onTouched" });
}

/** Puts server-side field errors on the form; returns true when it handled the error. */
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T, unknown, FieldValues>,
  err: unknown,
): boolean {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_ERROR") return false;
  const fields = (err.details?.fields as { path: string; code: string }[] | undefined) ?? [];
  for (const f of fields) if (f.path) form.setError(f.path as Path<T>, { type: "server", message: f.code });
  return fields.length > 0;
}

/** Translated message for a zod/server error code. */
export function useFieldError() {
  const t = useTranslations("validation");
  return (message?: string) => (message ? (t.has(message) ? t(message) : t("invalid")) : undefined);
}

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  type = "text",
  hint,
  autoComplete,
}: {
  form: UseFormReturn<T, unknown, FieldValues>;
  name: Path<T>;
  label: string;
  type?: string;
  hint?: string;
  autoComplete?: string;
}) {
  const fieldError = useFieldError();
  const message = form.formState.errors[name]?.message as string | undefined;
  return (
    <Field label={label} hint={hint} error={fieldError(message)}>
      {(id, describedBy) => (
        <Input
          id={id}
          type={type}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          invalid={!!message}
          {...form.register(name, { setValueAs: (v: string) => (v === "" ? undefined : v) })}
        />
      )}
    </Field>
  );
}
