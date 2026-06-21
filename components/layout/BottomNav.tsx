"use client";

import type { RemixiconComponentType } from "@remixicon/react";
import {
  RiBox3Fill,
  RiBox3Line,
  RiChat3Fill,
  RiChat3Line,
  RiHomeFill,
  RiHomeLine,
  RiMegaphoneFill,
  RiMegaphoneLine,
  RiShoppingBagFill,
  RiShoppingBagLine,
} from "@remixicon/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems: {
  href: string;
  label: string;
  IconLine: RemixiconComponentType;
  IconFill: RemixiconComponentType;
}[] = [
  { href: "/dashboard", label: "Home", IconLine: RiHomeLine, IconFill: RiHomeFill },
  { href: "/messages", label: "Chats", IconLine: RiChat3Line, IconFill: RiChat3Fill },
  { href: "/messages/broadcast", label: "Bulk", IconLine: RiMegaphoneLine, IconFill: RiMegaphoneFill },
  { href: "/orders", label: "Orders", IconLine: RiShoppingBagLine, IconFill: RiShoppingBagFill },
  { href: "/products", label: "Products", IconLine: RiBox3Line, IconFill: RiBox3Fill },
];

function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true;
  // Don't activate parent (/messages) when on a child (/messages/broadcast)
  if (href === "/messages" && pathname.startsWith("/messages/")) return false;
  return (
    pathname.startsWith(`${href}/`) ||
    (href === "/products" && pathname.startsWith("/add-product"))
  );
}

function PillNavLink({
  item,
  pathname,
}: {
  item: (typeof navItems)[number];
  pathname: string;
}) {
  const active = isActivePath(pathname, item.href);
  const Icon = active ? item.IconFill : item.IconLine;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      className={[
        "flex items-center justify-center rounded-full transition-[background-color,color] duration-200 ease-out",
        active
          ? "max-w-none shrink-0 gap-2 whitespace-nowrap bg-[#000000] px-4 py-2.5 text-[#ffffff] sm:gap-2.5 sm:px-[1.125rem] sm:py-2.5 dark:bg-[#ffffff] dark:text-[#000000]"
          : "min-h-[44px] min-w-[44px] p-2.5 text-[#000000] dark:text-[#ffffff]",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      <Icon
        size={24}
        className={[
          "shrink-0",
          active ? "text-[#ffffff] dark:text-[#000000]" : "text-[#000000] dark:text-[#ffffff]",
        ].join(" ")}
        aria-hidden
      />
      {active ? (
        <span className="font-nav-poppins text-[15px] leading-none tracking-tight text-[#ffffff] dark:text-[#000000] sm:text-[16px]">
          {item.label}
        </span>
      ) : null}
    </Link>
  );
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e5e7eb] bg-[#ffffff] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 dark:border-[var(--color-border)] dark:bg-[var(--background)] lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto flex w-full max-w-screen-lg items-center justify-evenly px-3 sm:px-5">
        {navItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <div
              key={item.href}
              className={[
                "flex justify-center",
                active ? "min-w-min shrink-0" : "min-w-0 flex-1 basis-0",
              ].join(" ")}
            >
              <PillNavLink item={item} pathname={pathname} />
            </div>
          );
        })}
      </div>
    </nav>
  );
}
