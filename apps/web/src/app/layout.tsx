import type { ReactNode } from "react";
import { PLATFORM_NAME } from "@idrok/shared";
import "./globals.css";

export const metadata = { title: PLATFORM_NAME };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
