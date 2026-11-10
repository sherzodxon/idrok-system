import { MiniAppEntry } from "@/components/telegram/mini-app";

// Telegram Mini App entry (M7): Telegram opens this page with signed initData in the URL hash.
export default function Page() {
  return <MiniAppEntry />;
}
