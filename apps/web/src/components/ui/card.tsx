import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border bg-surface shadow-card", className)} {...rest} />;
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {action}
    </div>
  );
}
