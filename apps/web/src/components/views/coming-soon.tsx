"use client";

import { Hammer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** Placeholder for sections built in M1 step 7. */
export function ComingSoon() {
  const t = useTranslations("states");
  return (
    <Card>
      <EmptyState
        icon={<Hammer className="size-6" aria-hidden />}
        title={t("comingSoonTitle")}
        text={t("comingSoonText")}
      />
    </Card>
  );
}
