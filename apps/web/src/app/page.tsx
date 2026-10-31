import { PLATFORM_NAME } from "@idrok/shared";

// Placeholder until the app shell (step 6). No UI copy here: texts come from next-intl.
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="rounded-card border border-border bg-surface px-10 py-8 text-2xl font-semibold text-primary">
        {PLATFORM_NAME}
      </div>
    </main>
  );
}
