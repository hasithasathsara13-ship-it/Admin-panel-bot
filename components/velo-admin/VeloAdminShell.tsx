"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const nav = [
  { href: "/velo-admin/analytics", label: "Dashboard", icon: "📊" },
  { href: "/velo-admin/businesses", label: "Businesses", icon: "🏢" },
  { href: "/velo-admin/add-business", label: "Add Business", icon: "➕" },
  { href: "/velo-admin/billing", label: "Billing", icon: "💳" },
  { href: "/velo-admin/plans", label: "Edit Plans", icon: "⚙️" },
] as const;

export function VeloAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/velo-admin/logout", { method: "POST", credentials: "include" });
    await supabase?.auth.signOut();
    router.replace("/login");
  }

  function isActive(href: string) {
    if (href === "/velo-admin/businesses") {
      return pathname === href || pathname.startsWith("/velo-admin/businesses/");
    }
    return pathname === href;
  }

  return (
    <div className="flex min-h-dvh bg-gradient-to-br from-[#070a12] via-[#0a0e1a] to-[#0c0a1e] text-slate-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-[#0b0f1c]/95 backdrop-blur-xl lg:flex">
        <div className="border-b border-white/10 px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-base font-bold shadow-lg shadow-indigo-500/30">
              V
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight">Velo.ai</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-indigo-300/70">
                Platform Admin
              </div>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          {nav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  active
                    ? "bg-gradient-to-r from-indigo-500/20 to-transparent text-white ring-1 ring-inset ring-indigo-500/30"
                    : "text-white/60 hover:bg-white/5 hover:text-white",
                ].join(" ")}
              >
                <span className={["text-base transition-transform duration-200", active ? "scale-110" : "group-hover:scale-110"].join(" ")}>{item.icon}</span>
                {item.label}
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400" />}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3 space-y-1">
          <Link
            href="/dashboard"
            className="block rounded-xl px-3 py-2 text-xs font-medium text-white/50 hover:bg-white/5 hover:text-white transition-colors"
          >
            ← Merchant dashboard
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-rose-300/70 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
          >
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/10 bg-[#070a12]/90 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold">
              V
            </div>
            <span className="text-sm font-semibold">Velo Admin</span>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap",
                    active ? "bg-white/10 text-white" : "text-white/70 hover:text-white",
                  ].join(" ")}
                >
                  {item.label}
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
