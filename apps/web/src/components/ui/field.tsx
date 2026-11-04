import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const base =
  "rounded-input border border-border bg-surface text-foreground placeholder:text-disabled focus:border-primary focus:outline-none aria-[invalid=true]:border-danger";
const control = `${base} px-3 text-sm`;
/** The default width and height unless the caller sets its own (cn does not merge Tailwind classes). */
const sized = (className?: string) =>
  cn(!/(^|\s)w-/.test(className ?? "") && "w-full", !/(^|\s)h-/.test(className ?? "") && "h-10");

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
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(control, sized(className), className)}
        {...rest}
      />
    );
  },
);

/** The app's select (styled list with search for long lists): see ./select.tsx. */
export { Select } from "./select";
