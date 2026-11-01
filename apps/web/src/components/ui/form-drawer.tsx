"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

/** Side drawer holding one form (`formId`), with cancel/save in the footer. */
export function FormDrawer({
  title,
  formId,
  busy,
  onClose,
  children,
  saveLabel,
}: {
  title: string;
  formId: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  saveLabel?: string;
}) {
  const t = useTranslations("common");
  return (
    <Modal
      open
      side="right"
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={busy} data-testid="drawer-save">
            {saveLabel ?? t("save")}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
