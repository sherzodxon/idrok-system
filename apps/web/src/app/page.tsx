import { redirect } from "next/navigation";

// The app shell sends students and guardians on to the portal.
export default function Index() {
  redirect("/dashboard");
}
