import { cn } from "@/lib/cn";

/** Initials avatar (photos arrive with the student photo feature). */
export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-strong",
        className,
      )}
    >
      {initials}
    </span>
  );
}
