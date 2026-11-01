import { PlanEditor } from "@/components/curriculum/plans-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanEditor id={id} backHref="/admin/plans" />;
}
