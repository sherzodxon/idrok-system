import { notFound } from "next/navigation";
import { UiKit } from "@/components/views/ui-kit";

/** Design-system reference; only in development builds (sample data, no API calls). */
export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiKit />;
}
