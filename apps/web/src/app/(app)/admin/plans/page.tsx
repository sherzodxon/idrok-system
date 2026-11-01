import { PlansList } from "@/components/curriculum/plans-pages";

export default function Page() {
  return <PlansList basePath="/admin/plans" mine={false} />;
}
