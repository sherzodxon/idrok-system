import { AttemptPage } from "@/components/tests/attempt-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AttemptPage attemptId={id} />;
}
