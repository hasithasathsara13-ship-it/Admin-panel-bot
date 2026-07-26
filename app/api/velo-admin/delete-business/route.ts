import { NextRequest, NextResponse } from "next/server";
import { requireVeloAdmin } from "@/lib/veloAdminRequest";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/velo-admin/delete-business
 * Permanently deletes a business and ALL related data.
 * Body: { shop_id }
 */
export async function POST(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: { shop_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
  if (!shopId) {
    return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });
  }

  const admin = createClient(url, key);

  try {
    // Delete in order (respecting foreign keys):
    // 1. Messages
    await admin.from("messages").delete().eq("shop_id", shopId);
    
    // 2. Orders
    await admin.from("orders").delete().eq("shop_id", shopId);
    
    // 3. Customers
    await admin.from("customers").delete().eq("shop_id", shopId);

    // 4. Products (includes images in storage)
    const { data: products } = await admin
      .from("products")
      .select("images")
      .eq("shop_id", shopId);
    
    // Delete product images from storage
    if (products && products.length > 0) {
      const allImages: string[] = [];
      for (const p of products) {
        const imgs = (p as { images?: string[] }).images;
        if (Array.isArray(imgs)) allImages.push(...imgs);
      }
      if (allImages.length > 0) {
        // Extract storage paths from URLs
        const paths = allImages
          .map((url) => {
            const match = url.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean) as string[];
        if (paths.length > 0) {
          await admin.storage.from("product-images").remove(paths);
        }
      }
    }
    await admin.from("products").delete().eq("shop_id", shopId);

    // 5. Conversation tracker (ignore errors — table may not exist)
    try {
      await admin.from("conversation_tracker").delete().eq("shop_id", shopId);
    } catch {
      /* table may not exist — ignore */
    }

    // 6. Finally, delete the business itself
    const { error: bizErr } = await admin.from("businesses").delete().eq("id", shopId);
    if (bizErr) {
      return NextResponse.json({ error: `Failed to delete business: ${bizErr.message}` }, { status: 500 });
    }

    // 7. Disconnect WhatsApp Web session if any
    const bridgeUrl = process.env.BAILEYS_BRIDGE_URL || "http://localhost:3001";
    const bridgeSecret = process.env.BAILEYS_BRIDGE_SECRET || "";
    try {
      await fetch(`${bridgeUrl}/session/${shopId}`, {
        method: "DELETE",
        headers: { "x-bridge-secret": bridgeSecret },
      });
    } catch { /* bridge might not be running */ }

    return NextResponse.json({ ok: true, deleted: shopId });
  } catch (err) {
    console.error("[delete-business]", err);
    return NextResponse.json({ error: "Deletion failed" }, { status: 500 });
  }
}
