"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface ShellBranding {
  schoolName: string;
  platformName: string;
}
const BrandingContext = createContext<ShellBranding>({ schoolName: "", platformName: "Idrok System" });

export const useShellBranding = () => useContext(BrandingContext);

export function BrandingProvider({ value, children }: { value: ShellBranding; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
