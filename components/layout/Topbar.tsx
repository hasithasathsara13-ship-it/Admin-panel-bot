"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AdminNotificationFeedItem } from "../../lib/adminNotificationFeedStorage";

export function Topbar({
  theme,
  onToggleTheme,
  notificationsEnabled,
  onToggleNotifications,
  notificationFeed,
  notificationUnreadCount,
  onNotificationMenuOpened,
  onClearNotificationFeed,
  displayName,
  userEmail,
  onLogout,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
  notificationFeed: AdminNotificationFeedItem[];
  notificationUnreadCount: number;
  onNotificationMenuOpened: () => void;
  onClearNotificationFeed: () => void;
  displayName: string;
  userEmail: string | null;
  onLogout: () => void | Promise<void>;
}) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notificationsOpen && !profileOpen) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (notifRef.current?.contains(t) || profileRef.current?.contains(t)) return;
      setNotificationsOpen(false);
      setProfileOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notificationsOpen, profileOpen]);

  useEffect(() => {
    if (notificationsOpen) onNotificationMenuOpened();
  }, [notificationsOpen, onNotificationMenuOpened]);

  const initial =
    displayName.trim().charAt(0).toUpperCase() ||
    (userEmail?.trim().charAt(0).toUpperCase() ?? "U");

  return (
    <header
      data-topbar
      className={[
        "sticky top-0 border-b border-[var(--panel-border)] bg-[var(--color-surface-solid)] shadow-[0_1px_0_rgba(0,0,0,0.04)]",
        notificationsOpen || profileOpen ? "z-[60]" : "z-30",
      ].join(" ")}
    >
      <div className="flex h-16 items-center justify-between px-4 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="shrink-0 lg:hidden">
            <Image
              src="/logo-dark.png"
              alt="Velo.ai"
              width={120}
              height={40}
              className="h-auto w-24 dark:hidden"
              priority
            />
            <Image
              src="/logo-light.png"
              alt="Velo.ai"
              width={120}
              height={40}
              className="h-auto w-24 hidden dark:block"
              priority
            />
          </div>
          <button
            type="button"
            aria-expanded={mobileSearchOpen}
            aria-label={mobileSearchOpen ? "Close search" : "Open search"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--panel-border-soft)] bg-[var(--panel-input-bg)] text-[var(--panel-icon)] transition-colors duration-200 hover:bg-[var(--panel-hover)] hover:text-[var(--panel-icon-strong)] md:hidden"
            onClick={() => setMobileSearchOpen((o) => !o)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <div className="hidden w-full max-w-sm items-center rounded-xl border border-[var(--panel-border-soft)] bg-[var(--panel-input-bg)] px-3.5 text-sm text-[var(--panel-subtext)] transition-all duration-200 focus-within:border-[var(--color-accent)] focus-within:bg-[var(--panel-input-focus-bg)] focus-within:shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-accent-glow)] md:flex">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-[var(--panel-icon)]">
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            <input
              readOnly
              placeholder="Search orders, products..."
              className="h-10 w-full bg-transparent px-2.5 text-[var(--panel-text)] outline-none placeholder:text-[var(--color-text-placeholder)]"
            />
            <kbd className="hidden rounded-md border border-[var(--panel-border-soft)] bg-[var(--panel-input-focus-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--panel-subtext)] lg:inline-block">
              ⌘K
            </kbd>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pl-2 sm:gap-2 sm:pl-4 lg:gap-3">
          <button
            type="button"
            className={[
              "group relative inline-flex h-7 w-14 items-center rounded-full border px-0.5 transition-all duration-300",
              theme === "light"
                ? "border-orange-500/60 bg-orange-500 shadow-[0_8px_20px_-10px_rgba(249,115,22,0.9)]"
                : "border-[var(--panel-border-soft)] bg-[var(--panel-input-bg)] shadow-[var(--shadow-card)]",
            ].join(" ")}
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            <span className="absolute left-1.5 text-[10px] text-white/90" aria-hidden>
              ☀
            </span>
            <span className="absolute right-1.5 text-[10px] text-white/90" aria-hidden>
              ☾
            </span>
            <span
              className={[
                "grid h-6 w-6 place-items-center rounded-full transition-all duration-300",
                theme === "light"
                  ? "translate-x-0 bg-white text-orange-500 shadow-[0_6px_18px_-8px_rgba(255,255,255,0.9)]"
                  : "translate-x-7 bg-gradient-to-br from-[#262136] to-[#111321] text-slate-200 shadow-[0_8px_16px_-8px_rgba(0,0,0,0.9)]",
              ].join(" ")}
            >
              <span className="text-[11px]" aria-hidden>
                {theme === "light" ? "☀" : "☾"}
              </span>
            </span>
          </button>

          <button
            type="button"
            className="hidden h-9 w-9 items-center justify-center rounded-xl text-[var(--panel-icon)] transition-all duration-200 hover:bg-[var(--panel-hover)] hover:text-[var(--panel-icon-strong)] sm:flex"
            aria-label="Help"
            title="Help"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          <div className="relative" ref={notifRef}>
            <button
              type="button"
              className={[
                "relative flex h-9 w-9 items-center justify-center rounded-xl text-[var(--panel-icon)] transition-all duration-200 hover:bg-[var(--panel-hover)] hover:text-[var(--panel-icon-strong)]",
                notificationsOpen ? "bg-[var(--panel-hover)] text-[var(--panel-icon-strong)]" : "",
              ].join(" ")}
              aria-expanded={notificationsOpen}
              aria-haspopup="true"
              aria-label="Notifications menu"
              onClick={() => {
                setNotificationsOpen((o) => !o);
                setProfileOpen(false);
              }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
                <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
              </svg>
              {notificationsEnabled || notificationUnreadCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              ) : null}
            </button>

            {notificationsOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-[44] bg-black/45 lg:hidden"
                  aria-label="Close notifications"
                  onClick={() => setNotificationsOpen(false)}
                />
                <div
                  className={[
                    "z-[46] overflow-hidden rounded-2xl border border-[var(--panel-border)] py-1 shadow-xl",
                    "bg-[var(--color-surface-solid)]",
                    "max-lg:fixed max-lg:left-1/2 max-lg:top-[calc(3.75rem+env(safe-area-inset-top,0px))] max-lg:w-[min(22rem,calc(100vw-1.5rem))] max-lg:-translate-x-1/2 max-lg:max-h-[min(70vh,calc(100dvh-5rem))]",
                    "lg:absolute lg:left-auto lg:right-0 lg:top-[calc(100%+0.5rem)] lg:w-[min(100vw-2rem,22rem)] lg:translate-x-0 lg:max-h-none",
                  ].join(" ")}
                  role="menu"
                >
                <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] px-4 py-3">
                  <span className="text-sm font-semibold text-[var(--panel-text)]">Notifications</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--panel-subtext)]">
                      {notificationsEnabled ? "On" : "Off"}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notificationsEnabled}
                      className={[
                        "relative h-7 w-12 shrink-0 rounded-full border transition-colors",
                        notificationsEnabled
                          ? "border-emerald-500/50 bg-emerald-500"
                          : "border-[var(--panel-border-soft)] bg-[var(--color-surface-secondary)]",
                      ].join(" ")}
                      onClick={() => void onToggleNotifications()}
                    >
                      <span
                        className={[
                          "absolute top-0.5 flex h-5 w-5 rounded-full bg-white shadow transition-transform",
                          notificationsEnabled ? "left-6" : "left-0.5",
                        ].join(" ")}
                      />
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto px-2 py-2">
                  {notificationFeed.length ? (
                    <ul className="space-y-1.5">
                      {notificationFeed.map((n) => (
                        <li
                          key={n.id}
                          className="rounded-xl border border-[var(--panel-border-soft)] bg-[var(--color-surface-secondary)] px-3 py-2.5 text-left"
                        >
                          <div className="text-xs font-semibold text-[var(--panel-text)]">{n.title}</div>
                          <div className="mt-0.5 text-xs leading-snug text-[var(--panel-subtext)]">
                            {n.body}
                          </div>
                          <div className="mt-1 text-[10px] text-[var(--panel-subtext)] opacity-80">
                            {formatNotifTime(n.createdAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg px-2 py-4 text-center text-xs text-[var(--panel-subtext)]">
                      No notifications yet. New orders and human handoff requests appear here when
                      they arrive.
                    </p>
                  )}
                  <p className="mt-2 rounded-lg border border-[var(--panel-border-soft)] bg-[var(--color-surface-secondary)] px-2 py-2 text-center text-[11px] leading-relaxed text-[var(--panel-subtext)]">
                    {notificationsEnabled
                      ? "Browser alerts are on (when this tab is open and permission is granted)."
                      : "Turn the switch on for extra browser alerts, in addition to this list."}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 border-t border-[var(--panel-border)] p-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center rounded-xl border border-[var(--panel-border-soft)] bg-[var(--color-surface-secondary)] px-3 py-2 text-xs font-semibold text-[var(--panel-text)] transition hover:bg-[var(--panel-hover)]"
                      onClick={() => {
                        onClearNotificationFeed();
                      }}
                    >
                      Clear all
                    </button>
                    <Link
                      href="/orders"
                      className="flex flex-1 items-center justify-center rounded-xl bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-white transition hover:brightness-105"
                      onClick={() => setNotificationsOpen(false)}
                    >
                      Orders
                    </Link>
                  </div>
                  <Link
                    href="/messages"
                    className="flex w-full items-center justify-center rounded-xl border border-[var(--panel-border-soft)] bg-[var(--color-surface-secondary)] px-3 py-2 text-xs font-semibold text-[var(--panel-text)] transition hover:bg-[var(--panel-hover)]"
                    onClick={() => setNotificationsOpen(false)}
                  >
                    Open messages
                  </Link>
                </div>
              </div>
              </>
            ) : null}
          </div>

          <div className="hidden h-6 w-px shrink-0 bg-[var(--panel-border)] sm:block" aria-hidden />

          <div className="relative" ref={profileRef}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-1.5 transition hover:bg-[var(--panel-hover)] sm:pr-2"
              aria-expanded={profileOpen}
              aria-haspopup="true"
              aria-label="Account menu"
              onClick={() => {
                setProfileOpen((o) => !o);
                setNotificationsOpen(false);
              }}
            >
              <div className="hidden min-w-0 text-right md:block">
                <div className="truncate text-sm font-semibold leading-tight text-[var(--panel-text)]">
                  {displayName}
                </div>
                <div className="truncate text-[11px] text-[var(--panel-subtext)]">Store Manager</div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-md ring-2 ring-white/80">
                {initial}
              </div>
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className={[
                  "h-4 w-4 shrink-0 text-[var(--panel-subtext)] transition-transform",
                  profileOpen ? "-rotate-180" : "",
                ].join(" ")}
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {profileOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-52 overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--color-surface-solid)] py-1 shadow-xl shadow-black/10 ring-1 ring-black/5"
                role="menu"
              >
                <div className="border-b border-[var(--panel-border)] px-3 py-2.5 md:hidden">
                  <div className="truncate text-sm font-semibold text-[var(--panel-text)]">{displayName}</div>
                  {userEmail ? (
                    <div className="truncate text-xs text-[var(--panel-subtext)]">{userEmail}</div>
                  ) : null}
                </div>
                <Link
                  href="/settings"
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-[var(--panel-text)] transition hover:bg-[var(--panel-hover)]"
                  onClick={() => setProfileOpen(false)}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px] text-[var(--panel-icon)]">
                    <path
                      fillRule="evenodd"
                      d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Profile
                </Link>
                <Link
                  href="/settings"
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-[var(--panel-text)] transition hover:bg-[var(--panel-hover)]"
                  onClick={() => setProfileOpen(false)}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px] text-[var(--panel-icon)]">
                    <path
                      fillRule="evenodd"
                      d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Settings
                </Link>
                <div className="my-1 border-t border-[var(--panel-border)]" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-[var(--color-danger)] transition hover:bg-[var(--color-danger-light)]"
                  onClick={() => {
                    setProfileOpen(false);
                    void onLogout();
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
                    <path
                      fillRule="evenodd"
                      d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {mobileSearchOpen ? (
        <div className="border-t border-[var(--panel-border)] px-4 pb-3 pt-2 md:hidden">
          <div className="flex w-full items-center rounded-xl border border-[var(--panel-border-soft)] bg-[var(--panel-input-bg)] px-3.5 text-sm text-[var(--panel-subtext)] transition-all duration-200 focus-within:border-[var(--color-accent)] focus-within:bg-[var(--panel-input-focus-bg)] focus-within:ring-2 focus-within:ring-[var(--color-accent-glow)]">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-[var(--panel-icon)]">
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            <input
              readOnly
              placeholder="Search orders, products..."
              className="h-10 w-full bg-transparent px-2.5 text-[var(--panel-text)] outline-none placeholder:text-[var(--color-text-placeholder)]"
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}

function formatNotifTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
