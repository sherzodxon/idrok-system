import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const base =
  "rounded-input border border-border bg-surface text-foreground placeholder:text-disabled focus:border-primary focus:outline-none aria-[invalid=true]:border-danger";
const control = `${base} w-full h-10 px-3 text-sm`;
const compactControl = `${base} h-8 px-2 text-xs`;

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children(fieldId, describedBy)}
      {error ? (
        <p id={`${fieldId}-error`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, className)} {...rest} />;
  },
);

/** `compact`: toolbar size, as wide as its content. */
export function Select({
  className,
  compact,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return <select className={cn(compact ? compactControl : control, "pr-8", className)} {...rest} />;
}
