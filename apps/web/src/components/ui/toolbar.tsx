"use client";

import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Input, Select } from "./field";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-2xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Debounced search box bound to the URL `q`. */
export function SearchInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => onChange(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text, value, onChange]);
  return (
    <label className="relative block w-full sm:max-w-xs">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        type="search"
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="pl-9"
      />
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <label className="block w-full sm:w-auto">
      <span className="sr-only">{label}</span>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="sm:w-48">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    // Bottom-aligned: a control with a visible label (date) lines up with the label-less controls beside it.
    <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-end">
      {children}
    </div>
  );
}

/** `inline`: inside a toolbar row (no own margin and border; aligned with the controls next to it). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  inline,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  inline?: boolean;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-1 overflow-x-auto", inline ? "h-10 items-stretch" : "mb-5 border-b border-border")}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            "-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted hover:text-foreground",
            value === tab.value && "border-primary text-primary-strong",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
