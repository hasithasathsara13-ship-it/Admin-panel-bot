import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BRIDGE_URL = process.env.BAILEYS_BRIDGE_URL || "http://localhost:3001";
const BRIDGE_SECRET = process.env.BAILEYS_BRIDGE_SECRET || "velo-bridge-dev-secret";

/**
 * POST /api/wa-bridge
 * Proxies requests to the Baileys bridge server.
 * Body: { action, shop_id, ...params }
 * Actions: create-session, session-status, send-text, send-image, edit, delete, disconnect
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const shopId = String(body.shop_id ?? "");

  if (!shopId) {
    return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });
  }

  try {
    let url: string;
    let method = "POST";
    let fetchBody: string | undefined;

    switch (action) {
      case "create-session":
        url = `${BRIDGE_URL}/session/create`;
        fetchBody = JSON.stringify({
          shop_id: shopId,
          phone_number: body.phone_number || undefined,
        });
        break;

      case "session-status":
        url = `${BRIDGE_URL}/session/${shopId}/status`;
        method = "GET";
        fetchBody = undefined;
        break;

      case "disconnect":
        url = `${BRIDGE_URL}/session/${shopId}`;
        method = "DELETE";
        fetchBody = undefined;
        break;

      case "send-text":
        url = `${BRIDGE_URL}/message/send-text`;
        fetchBody = JSON.stringify({
          shop_id: shopId,
          phone_number: body.phone_number,
          message: body.message,
        });
        break;

      case "send-image":
        url = `${BRIDGE_URL}/message/send-image`;
        fetchBody = JSON.stringify({
          shop_id: shopId,
          phone_number: body.phone_number,
          image_url: body.image_url,
          caption: body.caption,
        });
        break;

      case "edit":
        url = `${BRIDGE_URL}/message/edit`;
        fetchBody = JSON.stringify({
          shop_id: shopId,
          phone_number: body.phone_number,
          wa_message_id: body.wa_message_id,
          new_text: body.new_text,
        });
        break;

      case "delete":
        url = `${BRIDGE_URL}/message/delete`;
        fetchBody = JSON.stringify({
          shop_id: shopId,
          phone_number: body.phone_number,
          wa_message_id: body.wa_message_id,
        });
        break;

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const headers: Record<string, string> = {
      "x-bridge-secret": BRIDGE_SECRET,
    };
    if (fetchBody) headers["Content-Type"] = "application/json";

    const res = await fetch(url, { method, headers, body: fetchBody });
    const data = await res.json().catch(() => ({}));

    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[wa-bridge] Proxy error:", err);
    return NextResponse.json({ error: "Bridge server unavailable" }, { status: 503 });
  }
}
