import { UserPage } from "@/components/settings/user-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserPage id={id} />;
}
