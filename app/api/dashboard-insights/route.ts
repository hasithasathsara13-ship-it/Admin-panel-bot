import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dashboard-insights
 * Generates AI-powered insights from order and product data.
 * Body: { shop_id, orders_summary, products_summary }
 */
export async function POST(req: NextRequest) {
  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ insights: ["AI insights unavailable — OPENAI_API_KEY not configured."] });
  }

  let body: { shop_id?: string; orders_summary?: string; products_summary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const ordersSummary = body.orders_summary || "No order data";
  const productsSummary = body.products_summary || "No product data";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `You are a business analytics AI for a WhatsApp e-commerce store. Analyze the provided sales data and give 3-5 concise, actionable insights. Focus on:
- Which products sell best and why
- Revenue trends and predictions
- Customer behavior patterns
- Inventory recommendations
- Growth opportunities

Keep each insight to 1-2 sentences max. Be specific with numbers. Format as a JSON array of strings.`,
          },
          {
            role: "user",
            content: `ORDERS DATA:\n${ordersSummary}\n\nPRODUCTS DATA:\n${productsSummary}\n\nProvide 3-5 actionable business insights as a JSON array of strings. Example: ["Nike Air Force 1 accounts for 60% of revenue — consider expanding Nike inventory", "Orders peak on weekends — schedule promotions for Friday evenings"]`,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!res.ok) {
      console.error("[dashboard-insights] OpenAI error:", res.status);
      return NextResponse.json({ insights: ["AI analysis temporarily unavailable."] });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "[]";
    
    // Parse the JSON array from GPT's response
    let insights: string[];
    try {
      // Try to extract JSON array from the response (GPT sometimes wraps in markdown)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      insights = jsonMatch ? JSON.parse(jsonMatch[0]) : [content];
    } catch {
      insights = [content];
    }

    return NextResponse.json({ insights });
  } catch (err) {
    console.error("[dashboard-insights]", err);
    return NextResponse.json({ insights: ["Unable to generate insights at this time."] });
  }
}
