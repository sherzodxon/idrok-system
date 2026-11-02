import { TestDetailPage } from "@/components/tests/tests-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TestDetailPage id={id} base="/admin/tests" />;
}
