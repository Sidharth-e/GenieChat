import { RailShell } from "@/components/layout/rail-shell";

export default function RailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RailShell>{children}</RailShell>;
}
