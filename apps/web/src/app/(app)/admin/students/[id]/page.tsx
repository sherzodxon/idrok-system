import { StudentProfile } from "@/components/people/student-profile";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentProfile id={id} backHref="/admin/students" />;
}
