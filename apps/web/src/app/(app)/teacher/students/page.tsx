import { StudentsList } from "@/components/people/students-list";

export default function Page() {
  return <StudentsList basePath="/teacher/students" variant="teacher" />;
}
