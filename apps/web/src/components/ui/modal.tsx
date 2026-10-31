"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/** Native <dialog>: focus trap, Esc and backdrop come from the browser. `side` renders it as a drawer. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  side,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations("common");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-auto max-h-[90vh] w-[min(32rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-0 text-foreground shadow-card backdrop:bg-overlay",
        side && "my-0 h-dvh max-h-dvh w-[min(26rem,100vw)] rounded-none",
        side === "right" && "mr-0",
        side === "left" && "ml-0",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-button p-1 text-muted hover:bg-surface-muted"
          aria-label={t("close")}
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  text,
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("common");
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{text}</p>
    </Modal>
  );
}
