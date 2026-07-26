"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatInterface } from "../../components/ChatInterface";
import { WhatsAppConnect } from "../../components/WhatsAppConnect";
import { supabase } from "../../lib/supabaseClient";
import { getActiveShopId } from "../../lib/activeShopId";

export default function MessagesPage() {
  const [connectionMode, setConnectionMode] = useState<"cloud_api" | "whatsapp_web" | null>(null);
  const [waWebConnected, setWaWebConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!supabase) { setLoading(false); return; }
      const shopId = getActiveShopId();
      if (!shopId) { setLoading(false); return; }

      // Try fetching connection_mode; if column doesn't exist, fall back
      const { data, error } = await supabase
        .from("businesses")
        .select("connection_mode, wa_web_connected")
        .eq("id", shopId)
        .maybeSingle();

      if (error) {
        // Column might not exist — try without it
        const { data: fallback } = await supabase
          .from("businesses")
          .select("id")
          .eq("id", shopId)
          .maybeSingle();
        // If we at least found the business, default to cloud_api
        if (fallback) {
          setConnectionMode("cloud_api");
        }
        setLoading(false);
        return;
      }

      const row = data as { connection_mode?: string; wa_web_connected?: boolean } | null;
      const mode = (row?.connection_mode as "cloud_api" | "whatsapp_web") ?? "cloud_api";
      setConnectionMode(mode);

      // For whatsapp_web businesses, also check live bridge status
      if (mode === "whatsapp_web") {
        try {
          const bridgeRes = await fetch("/api/wa-bridge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "session-status", shop_id: shopId }),
          });
          const bridgeData = await bridgeRes.json();
          if (bridgeData.status === "connected") {
            setWaWebConnected(true);
          } else {
            setWaWebConnected(false);
          }
        } catch {
          // Bridge might be down — check DB value
          setWaWebConnected(row?.wa_web_connected ?? false);
        }
      }

      setLoading(false);
    }
    void load();
  }, []);

  const handleConnected = useCallback(() => {
    setWaWebConnected(true);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // Meta Cloud API businesses → show chat interface directly
  if (connectionMode === "cloud_api") {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatInterface connectionMode="cloud_api" />
        </div>
      </div>
    );
  }

  // WhatsApp Web businesses → show QR connect if not connected, else chat
  if (connectionMode === "whatsapp_web" && !waWebConnected) {
    return <WhatsAppConnect onConnected={handleConnected} />;
  }

  // Connected WhatsApp Web → show chat interface
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatInterface connectionMode="whatsapp_web" />
      </div>
    </div>
  );
}
