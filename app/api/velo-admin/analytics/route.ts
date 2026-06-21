import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireVeloAdmin } from "@/lib/veloAdminRequest";
import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";
import {
  fillDailySeries,
  lastNDatesUtc,
  messagesDailyFromCreatedAts,
  revenueFromBusinesses,
  signupsDailyFromBusinesses,
  type BusinessForRevenue,
} from "@/lib/veloAdminAnalyticsFormat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAYS = 30;

const MESSAGE_SCAN_PAGE = 1000;
const MESSAGE_SCAN_MAX_PAGES = 500;

async function loadMessageCreatedAtsSince(
  admin: SupabaseClient,
  sinceIso: string,
): Promise<{ createdAts: string[]; truncated: boolean }> {
  const out: string[] = [];
  for (let page = 0; page < MESSAGE_SCAN_MAX_PAGES; page++) {
    const from = page * MESSAGE_SCAN_PAGE;
    const to = from + MESSAGE_SCAN_PAGE - 1;
    const { data, error } = await admin
      .from("messages")
      .select("created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, to);
    if (error) return { createdAts: out, truncated: true };
    const rows = data ?? [];
    for (const r of rows) {
      const ca = (r as { created_at?: string | null }).created_at;
      if (ca) out.push(String(ca));
    }
    if (rows.length < MESSAGE_SCAN_PAGE) return { createdAts: out, truncated: false };
  }
  return { createdAts: out, truncated: true };
}

export async function GET(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const { data: businesses, error: bizErr } = await admin
    .from("businesses")
    .select(
      [
        "id",
        "business_name",
        "billing_plan",
        "billing_cycle",
        "subscription_status",
        "created_at",
        "billing_messages_used_period",
      ].join(", "),
    );

  if (bizErr) {
    return NextResponse.json({ error: bizErr.message }, { status: 500 });
  }

  const bizList = (businesses ?? []) as Array<{
    id?: string;
    business_name?: string | null;
    billing_plan?: string | null;
    billing_cycle?: string | null;
    subscription_status?: string | null;
    created_at?: string | null;
    billing_messages_used_period?: number | null;
  }>;
  const revenue = revenueFromBusinesses(bizList as BusinessForRevenue[]);

  const active = bizList.filter((b) => String(b.subscription_status ?? "active") === "active").length;
  const pastDue = bizList.filter((b) => String(b.subscription_status) === "past_due").length;
  const canceled = bizList.filter((b) => String(b.subscription_status) === "canceled").length;

  const dates = lastNDatesUtc(DAYS);
  const since = `${dates[0]}T00:00:00.000Z`;

  const createdAts = bizList
    .map((b) => (b as { created_at?: string | null }).created_at)
    .filter((x): x is string => typeof x === "string" && x >= since);

  const signupsDaily = signupsDailyFromBusinesses(dates, createdAts);

  let messagesDaily = fillDailySeries(dates, [], "total");
  let ordersGmvDaily = fillDailySeries(dates, [], "gmv");

  const { data: msgRows, error: msgErr } = await admin.rpc("velo_admin_message_daily_counts", {
    p_days: DAYS,
  });

  const rpcMessagesOk = !msgErr && Array.isArray(msgRows);
  if (rpcMessagesOk) {
    messagesDaily = fillDailySeries(
      dates,
      msgRows as Array<{ bucket_date: string; total: number | bigint }>,
      "total",
    );
  }

  const rpcMessageSum = messagesDaily.reduce((s, p) => s + p.value, 0);

  let messagesRpcNote: string | null = null;
  if (!rpcMessagesOk || rpcMessageSum === 0) {
    const { count: messagesInRange, error: headErr } = await admin
      .from("messages")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);

    const n = headErr ? 0 : (messagesInRange ?? 0);
    if (n > 0) {
      const { createdAts, truncated } = await loadMessageCreatedAtsSince(admin, since);
      messagesDaily = messagesDailyFromCreatedAts(dates, createdAts);
      if (truncated) {
        messagesRpcNote = `Message totals from row scan (first ${createdAts.length.toLocaleString()} rows in range).`;
      }
    } else if (msgErr) {
      messagesRpcNote = String(msgErr.message);
    }
  }

  const { data: ordRows, error: ordErr } = await admin.rpc("velo_admin_orders_daily_gmv", {
    p_days: DAYS,
  });
  if (!ordErr && Array.isArray(ordRows)) {
    ordersGmvDaily = fillDailySeries(
      dates,
      ordRows as Array<{ bucket_date: string; gmv: number | string }>,
      "gmv",
    );
  }

  const messages30d = messagesDaily.reduce((s, p) => s + p.value, 0);
  const ordersGmv30d = ordersGmvDaily.reduce((s, p) => s + p.value, 0);

  const usagePeriodTotal = bizList.reduce(
    (s, b) => s + Number((b as { billing_messages_used_period?: number }).billing_messages_used_period ?? 0),
    0,
  );

  return NextResponse.json({
    dates,
    messagesDaily,
    ordersGmvDaily,
    signupsDaily,
    revenue,
    totals: {
      businesses: bizList.length,
      activeSubscriptions: active,
      pastDue,
      canceled,
      messagesInbound30d: messages30d,
      ordersGmv30dLkr: Math.round(ordersGmv30d * 100) / 100,
      billingPeriodMessagesReported: usagePeriodTotal,
    },
    rpc: {
      messages: messagesRpcNote,
      orders: ordErr ? String(ordErr.message) : null,
    },
  });
}
