"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

const navItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
      </svg>
    ),
  },
  {
    href: "/orders",
    label: "Orders",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/products",
    label: "Products",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path fillRule="evenodd" d="M10 2l6 3.5v9L10 18l-6-3.5v-9L10 2zm0 2.236L6 6.5v7l4 2.264 4-2.264v-7L10 4.236z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/customers",
    label: "Customers",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
      </svg>
    ),
  },
  {
    href: "/messages",
    label: "Messages",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9H7v2h2V9z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/messages/broadcast",
    label: "Bulk",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path d="M18 3a1 1 0 00-1.196-.98l-14 4A1 1 0 002 7v2a1 1 0 00.725.962L9 11.723V17a1 1 0 001.6.8l3-2.25a1 1 0 00.4-.8v-2.973l3.275-.936A1 1 0 0018 10V3z" />
      </svg>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
      </svg>
    ),
  },
  {
    href: "/add-product",
    label: "Add Product",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col border-r border-[var(--panel-border)] bg-[var(--panel-bg-strong)] backdrop-blur-xl">
      {/* Logo */}
      <div className="px-6 pb-2 pt-7">
        <div className="flex items-center">
          <Image
            src="/logo-dark.png"
            alt="Velo.ai"
            width={176}
            height={58}
            className="h-auto w-36 dark:hidden"
            priority
          />
          <Image
            src="/logo-light.png"
            alt="Velo.ai"
            width={176}
            height={58}
            className="h-auto w-36 hidden dark:block"
            priority
          />
        </div>
        <div className="mt-1 text-[11px] font-medium text-[var(--panel-subtext)]">
          Business Dashboard
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 my-3 border-t border-[var(--panel-border)]" />

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-4 text-sm">
        {navItems.map((item) => {
          const active =
            pathname === item.href ||
            (pathname.startsWith(`${item.href}/`) &&
              !navItems.some((other) => other.href !== item.href && other.href.startsWith(`${item.href}/`) && pathname.startsWith(other.href)));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "group flex items-center justify-start gap-3 rounded-xl px-3 py-2.5 font-medium transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-[var(--color-accent-light)] to-transparent text-[var(--color-accent)] shadow-sm ring-1 ring-inset ring-[var(--panel-border-soft)]"
                  : "text-[var(--panel-subtext)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]",
              ].join(" ")}
            >
              <span className={[
                "flex-shrink-0 transition-all duration-200",
                active
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--panel-icon)] group-hover:text-[var(--panel-icon-strong)]",
              ].join(" ")}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-4">
        <div className="border-t border-[var(--panel-border)] pt-3">
          <button
            type="button"
            className="group flex w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--panel-subtext)] transition-all duration-200 hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]"
            onClick={async () => {
              try {
                await supabase?.auth.signOut();
              } finally {
                localStorage.removeItem("active_shop_id");
                localStorage.removeItem("active_shop_email");
                router.replace("/login");
              }
            }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px] text-[var(--panel-icon)] transition-colors duration-200 group-hover:text-[var(--color-danger)]">
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
