import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dashboard-insights
 * Generates AI-powered insights from order and product data using Gemini.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ insights: ["AI insights unavailable — GEMINI_API_KEY not configured."] });
  }

  let body: { orders_summary?: string; products_summary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const ordersSummary = body.orders_summary || "No order data";
  const productsSummary = body.products_summary || "No product data";

  const prompt = `You are a business analytics AI for a WhatsApp e-commerce store. Analyze the provided sales data and give 3-5 concise, actionable insights.

Focus on:
- Which products sell best and why
- Revenue trends and predictions
- Customer behavior patterns
- Inventory recommendations
- Growth opportunities

ORDERS DATA:
${ordersSummary}

PRODUCTS DATA:
${productsSummary}

Respond ONLY with a JSON array of 3-5 strings. Each string is one insight (1-2 sentences max). Be specific with numbers.
Example: ["Nike Air Force 1 accounts for 60% of revenue — consider expanding Nike inventory", "Orders peak on weekends — schedule promotions for Friday evenings"]`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[dashboard-insights] Gemini error:", res.status, errText);
      return NextResponse.json({ insights: ["AI analysis temporarily unavailable."] });
    }

    const data = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    // Parse the JSON array from Gemini's response
    let insights: string[];
    try {
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
