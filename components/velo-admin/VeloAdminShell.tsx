"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const nav = [
  { href: "/velo-admin/analytics", label: "Analytics" },
  { href: "/velo-admin/businesses", label: "Business manage" },
] as const;

export function VeloAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/velo-admin/logout", { method: "POST", credentials: "include" });
    await supabase?.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-dvh bg-[#070a12] text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-[#0c101c]/95 backdrop-blur-xl lg:flex">
        <div className="border-b border-white/10 px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold shadow-lg shadow-indigo-500/25">
              V
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Velo.ai</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-white/75">
                Platform
              </div>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  active
                    ? "bg-white/10 text-white shadow-inner shadow-white/5 ring-1 ring-inset ring-white/10"
                    : "text-white/80 hover:bg-white/5 hover:text-white",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <Link
            href="/dashboard"
            className="mb-2 block rounded-xl px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/5 hover:text-white"
          >
            Merchant dashboard →
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-rose-300/90 hover:bg-rose-500/10"
          >
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/10 bg-[#070a12]/90 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold">
              V
            </div>
            <span className="text-sm font-semibold">Velo</span>
          </div>
          <div className="flex gap-1">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "rounded-lg px-2.5 py-1.5 text-xs font-medium",
                    active ? "bg-white/10 text-white" : "text-white/80 hover:text-white",
                  ].join(" ")}
                >
                  {item.label === "Business manage" ? "Business" : "Analytics"}
                </Link>
              );
            })}
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
