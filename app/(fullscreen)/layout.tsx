"use client";

import { MainShell } from "@/components/layout/main-shell";

export default function ImmersiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainShell showHeader={false}>{children}</MainShell>;
}
