"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { Me } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { useToast } from "@/components/ui/toast";
import { ChangePasswordForm } from "@/components/views/change-password-form";
import { ME_KEY, homePath } from "@/lib/use-me";

export default function ChangePasswordPage() {
  const t = useTranslations("auth");
  const api = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("changeTitle")}</h1>
        <p className="text-sm text-muted">{t("changeSubtitle")}</p>
      </div>
      <ChangePasswordForm
        onDone={async () => {
          toast("success", t("passwordChanged"));
          const me = await api.get<Me>("/me");
          qc.setQueryData(ME_KEY, me);
          router.replace(homePath(me));
        }}
      />
    </div>
  );
}
