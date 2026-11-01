import { StudentProfile } from "@/components/people/student-profile";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentProfile id={id} backHref="/teacher/students" />;
}
