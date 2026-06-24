import { NextRequest, NextResponse } from "next/server";
import { resolveMetaApiToken, resolveWabaId } from "@/lib/whatsappMetaPhone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRAPH_VERSION = "v18.0";

/**
 * GET /api/templates?shop_id=...
 * Lists all message templates from Meta with their approval status.
 * Uses per-business WABA ID and token (falls back to env).
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id") || undefined;
  const token = await resolveMetaApiToken(shopId);
  const wabaId = await resolveWabaId(shopId);

  if (!token || !wabaId) {
    return NextResponse.json(
      { error: "WhatsApp Business Account not configured for this business." },
      { status: 500 },
    );
  }

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?limit=100&fields=name,status,category,language,components`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Failed to fetch templates from Meta", details: err },
        { status: res.status },
      );
    }

    const data = await res.json();
    const templates = (data.data ?? []) as Array<{
      name: string;
      status: string;
      category: string;
      language: string;
      components: unknown[];
    }>;

    return NextResponse.json({ templates });
  } catch (err) {
    console.error("[templates] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/templates
 * Creates a new message template and submits to Meta for approval.
 *
 * Body: {
 *   name: string,          // lowercase, underscores only
 *   category: "MARKETING" | "UTILITY",
 *   language: string,      // e.g. "en", "en_US"
 *   header_text?: string,  // optional header
 *   body_text: string,     // main message body (supports {{1}}, {{2}} variables)
 *   footer_text?: string,  // optional footer
 *   button_text?: string,  // optional CTA button label
 *   button_url?: string,   // optional CTA button URL
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      category,
      language,
      header_text,
      header_type,
      body_text,
      footer_text,
      button_text,
      button_url,
      shop_id,
    } = body as {
      name?: string;
      category?: string;
      language?: string;
      header_text?: string;
      header_type?: string;
      body_text?: string;
      footer_text?: string;
      button_text?: string;
      button_url?: string;
      shop_id?: string;
    };

    const token = await resolveMetaApiToken(shop_id);
    const wabaId = await resolveWabaId(shop_id);

    if (!token || !wabaId) {
      return NextResponse.json(
        { error: "WhatsApp Business Account not configured for this business." },
        { status: 500 },
      );
    }

    if (!name || !body_text) {
      return NextResponse.json(
        { error: "name and body_text are required" },
        { status: 400 },
      );
    }

    // Validate name format (Meta requires lowercase + underscores only)
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!cleanName) {
      return NextResponse.json(
        { error: "Template name must contain only lowercase letters, numbers, and underscores" },
        { status: 400 },
      );
    }

    // Build components array
    const components: Array<Record<string, unknown>> = [];

    const hType = (header_type || "NONE").toUpperCase();
    if (hType === "IMAGE" || hType === "VIDEO" || hType === "DOCUMENT") {
      components.push({
        type: "HEADER",
        format: hType,
      });
    } else if (hType === "TEXT" && header_text?.trim()) {
      components.push({
        type: "HEADER",
        format: "TEXT",
        text: header_text.trim(),
      });
    }

    components.push({
      type: "BODY",
      text: body_text.trim(),
      ...(body_text.includes("{{") ? {
        example: {
          body_text: [
            Array.from({ length: (body_text.match(/\{\{\d+\}\}/g) || []).length }, (_, i) => 
              i === 0 ? "Customer" : `value${i + 1}`
            ),
          ],
        },
      } : {}),
    });

    if (footer_text?.trim()) {
      components.push({
        type: "FOOTER",
        text: footer_text.trim(),
      });
    }

    if (button_text?.trim() && button_url?.trim()) {
      components.push({
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: button_text.trim(),
            url: button_url.trim(),
          },
        ],
      });
    }

    const payload = {
      name: cleanName,
      category: category || "MARKETING",
      language: language || "en",
      components,
    };

    console.log("[templates] Creating template with payload:", JSON.stringify(payload, null, 2));

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[templates] POST Meta error:", data);
      const errMsg = (data as { error?: { message?: string } })?.error?.message || "Template creation failed";
      return NextResponse.json(
        { error: errMsg, details: data },
        { status: res.status },
      );
    }

    return NextResponse.json({ ok: true, template: data });
  } catch (err) {
    console.error("[templates] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/templates?name=template_name
 * Deletes a message template.
 */
export async function DELETE(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id") || undefined;
  const token = await resolveMetaApiToken(shopId);
  const wabaId = await resolveWabaId(shopId);

  if (!token || !wabaId) {
    return NextResponse.json(
      { error: "WhatsApp Business Account not configured for this business." },
      { status: 500 },
    );
  }

  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Missing template name" }, { status: 400 });
  }

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`;

    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Failed to delete template", details: err },
        { status: res.status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[templates] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
