import { VeloAdminShell } from "@/components/velo-admin/VeloAdminShell";

export default function VeloAdminLayout({ children }: { children: React.ReactNode }) {
  return <VeloAdminShell>{children}</VeloAdminShell>;
}
