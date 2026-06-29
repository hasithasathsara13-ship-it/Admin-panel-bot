"use client";

import Image from "next/image";
import Spline from "@splinetool/react-spline";
import type { Application } from "@splinetool/runtime";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { resolveShopIdForUser } from "../../lib/shopResolver";
import { ensureBusinessForUser } from "../../lib/tenantBootstrap";
import { Skeleton } from "../../components/ui/skeleton";
import { safeVeloAdminNext } from "@/lib/veloPlatformAdmin";

async function fetchPlatformAdminSession(accessToken: string): Promise<{
  admin: boolean;
  serverError?: string;
}> {
  const res = await fetch("/api/velo-admin/session-from-auth", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
  });
  const j = (await res.json().catch(() => ({}))) as { admin?: boolean; error?: string };
  if (res.status === 503) {
    return { admin: false, serverError: j.error ?? "Platform admin session is not configured." };
  }
  if (!res.ok) {
    return { admin: false };
  }
  return { admin: Boolean(j.admin) };
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextAdminPath = safeVeloAdminNext(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSplineLoad = useCallback((app: Application) => {
    app.setGlobalEvents(true);
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      if (!mounted) return;
      try {
        if (!supabase) throw new Error("Supabase client is not configured.");
        const res = await supabase.auth.getSession();
        if (!mounted) return;
        const session = res?.data?.session;
        if (!session) {
          setSessionLoading(false);
          return;
        }
        const { admin, serverError } = await fetchPlatformAdminSession(session.access_token);
        if (!mounted) return;
        if (serverError) {
          setError(serverError);
          setSessionLoading(false);
          return;
        }
        router.replace(admin ? nextAdminPath : "/dashboard");
      } catch {
        // If session fetch fails, still allow showing login.
      } finally {
        if (!mounted) return;
        setSessionLoading(false);
      }
    }

    void loadSession();
    return () => {
      mounted = false;
    };
  }, [router, nextAdminPath]);

  async function onLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!supabase) throw new Error("Supabase client is not configured.");

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        throw new Error(
          `${signInError.message}${signInError.code ? ` (${signInError.code})` : ""}`,
        );
      }

      const user = data.user;
      if (!user) throw new Error("Login failed: user not found in response.");

      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Login failed: no access token.");

      const { admin, serverError } = await fetchPlatformAdminSession(accessToken);
      if (serverError) {
        throw new Error(serverError);
      }

      const ensuredBusinessId = await ensureBusinessForUser(supabase, {
        id: user.id,
        email: user.email,
        user_metadata: (user.user_metadata as Record<string, unknown> | null) ?? null,
      });

      const shopId = await resolveShopIdForUser(supabase, {
        id: user.id,
        email: user.email,
      });

      const activeShopId = shopId ?? ensuredBusinessId;
      if (activeShopId) localStorage.setItem("active_shop_id", activeShopId);
      if (user.email) localStorage.setItem("active_shop_email", user.email);

      router.replace(admin ? nextAdminPath : "/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed.";
      const friendly =
        msg.includes("invalid_credentials") ||
        msg.toLowerCase().includes("invalid login credentials")
          ? `${msg}\n\nFix: Ensure the business auth user exists in Supabase Auth for this project and the password is correct (Supabase uses the Auth users table, not the shops table for password verification).`
          : msg;

      setError(friendly);
      setLoading(false);
    }
  }

  if (sessionLoading) {
    return (
      <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-900">
        <div className="mx-auto flex min-h-dvh w-full max-w-6xl items-center px-4 py-10">
          <div className="grid w-full gap-0 overflow-hidden rounded-[32px] border border-white/80 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-800/95 shadow-2xl shadow-zinc-900/5 dark:shadow-black/30 lg:grid-cols-2">
            <div className="space-y-5 p-8 sm:p-10 lg:p-12">
              <Skeleton className="h-10 w-40 rounded-full" />
              <Skeleton className="h-7 w-52 rounded" />
              <Skeleton className="h-11 w-full rounded-xl" />
              <Skeleton className="h-11 w-full rounded-xl" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <div className="hidden lg:block">
              <Skeleton className="h-full min-h-[620px] w-full rounded-none" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-100/70 dark:bg-zinc-900 px-4 py-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-6xl items-center">
        <div className="grid w-full overflow-hidden rounded-[32px] border border-white/80 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-800/95 shadow-2xl shadow-zinc-900/10 dark:shadow-black/30 lg:grid-cols-2">
          <div className="flex items-center justify-center p-8 sm:p-10 lg:p-12">
            <div className="w-full max-w-sm space-y-6">
              <div className="inline-flex rounded-full border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/70 dark:bg-indigo-950/50 px-4 py-2 shadow-sm">
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

              <div className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Welcome Back!</h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Where Advanced AI Meets Human Insight
                </p>
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200/60 dark:border-red-800/60 bg-red-50/80 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300 shadow-sm">
                  {error}
                </div>
              ) : null}

              <form onSubmit={(e) => void onLogin(e)} className="space-y-4">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Email</span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    placeholder="Email or phone number"
                    className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-600 bg-zinc-50/70 dark:bg-zinc-700/70 px-3 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none transition focus:border-indigo-400 dark:focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-700 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/50"
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Password</span>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter password"
                    className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-600 bg-zinc-50/70 dark:bg-zinc-700/70 px-3 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none transition focus:border-indigo-400 dark:focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-700 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/50"
                  />
                </label>

                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-400 dark:bg-zinc-700"
                    />
                    Remember me
                  </label>
                  <button
                    type="button"
                    className="font-medium text-indigo-600 dark:text-indigo-400 transition hover:text-indigo-700 dark:hover:text-indigo-300"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-indigo-200/60 dark:shadow-indigo-900/40 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={loading}
                >
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </form>

              <div className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              </div>
            </div>
          </div>

          <div className="relative hidden h-full min-h-[620px] bg-zinc-950 lg:block overflow-hidden">
            <Spline
              scene="https://prod.spline.design/E2X2PCynG70f138U/scene.splinecode"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              onLoad={(splineApp) => {
                // Restart all animations every 10 seconds to simulate looping
                const restart = () => {
                  try {
                    splineApp.stop();
                    splineApp.play();
                  } catch { /* ignore */ }
                };
                // Get approximate animation duration and loop
                const interval = setInterval(restart, 10000);
                (window as unknown as Record<string, unknown>).__splineInterval = interval;
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-900">
          <div className="mx-auto flex min-h-dvh w-full max-w-6xl items-center px-4 py-10">
            <div className="grid w-full gap-0 overflow-hidden rounded-[32px] border border-white/80 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-800/95 shadow-2xl shadow-zinc-900/5 dark:shadow-black/30 lg:grid-cols-2">
              <div className="space-y-5 p-8 sm:p-10 lg:p-12">
                <Skeleton className="h-10 w-40 rounded-full" />
                <Skeleton className="h-7 w-52 rounded" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
              <div className="hidden lg:block">
                <Skeleton className="h-full min-h-[620px] w-full rounded-none" />
              </div>
            </div>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
