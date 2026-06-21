import { redirect } from "next/navigation";

export default function VeloAdminLoginDeprecatedPage() {
  redirect("/login?next=/velo-admin/analytics");
}
