import { LessonJournalPage } from "@/components/scores/scores-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LessonJournalPage lessonId={id} backHref="/admin/gradebook" />;
}
