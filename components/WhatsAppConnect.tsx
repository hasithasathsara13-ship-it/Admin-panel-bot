"use client";

import { useCallback, useEffect, useState } from "react";
import { getActiveShopId } from "../lib/activeShopId";

type SessionStatus = "disconnected" | "connecting" | "qr" | "connected";

type SessionInfo = {
  status: SessionStatus;
  qrCode: string | null;
  pairingCode: string | null;
};

/**
 * WhatsApp Web connection UI.
 * Shows QR code or pairing code input for businesses using whatsapp_web mode.
 * Once connected, calls onConnected() to show the chat interface.
 */
export function WhatsAppConnect({ onConnected }: { onConnected: () => void }) {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({
    status: "disconnected",
    qrCode: null,
    pairingCode: null,
  });
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"qr" | "phone">("qr");
  const [phoneInput, setPhoneInput] = useState("");

  const shopId = typeof window !== "undefined" ? getActiveShopId() : null;

  // Check session status on mount
  useEffect(() => {
    if (!shopId) return;
    void checkStatus();
  }, [shopId]);

  // Poll for status updates while connecting/scanning — poll faster (2s)
  useEffect(() => {
    if (sessionInfo.status === "connected" || sessionInfo.status === "disconnected") return;
    const interval = setInterval(() => void checkStatus(), 2000);
    return () => clearInterval(interval);
  }, [sessionInfo.status]);

  // If connected, show loading animation then redirect
  useEffect(() => {
    if (sessionInfo.status === "connected") {
      setRedirecting(true);
      // Small delay so user sees the "Connected!" animation
      setTimeout(() => onConnected(), 1500);
    }
  }, [sessionInfo.status, onConnected]);

  const checkStatus = useCallback(async () => {
    if (!shopId) return;
    try {
      const res = await fetch("/api/wa-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session-status", shop_id: shopId }),
      });
      const data = await res.json();
      setSessionInfo({
        status: data.status ?? "disconnected",
        qrCode: data.qrCode ?? null,
        pairingCode: data.pairingCode ?? null,
      });
    } catch {
      // Bridge unavailable
    }
  }, [shopId]);

  const startSession = async () => {
    if (!shopId) return;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, string> = { action: "create-session", shop_id: shopId };
      if (mode === "phone" && phoneInput.trim()) {
        body.phone_number = phoneInput.trim();
      }
      const res = await fetch("/api/wa-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create session");
      } else {
        setSessionInfo({
          status: data.status ?? "connecting",
          qrCode: data.qrCode ?? null,
          pairingCode: data.pairingCode ?? null,
        });
      }
    } catch {
      setError("Bridge server unavailable. Make sure it is running.");
    }
    setLoading(false);
  };

  const disconnect = async () => {
    if (!shopId) return;
    await fetch("/api/wa-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect", shop_id: shopId }),
    });
    setSessionInfo({ status: "disconnected", qrCode: null, pairingCode: null });
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        {/* Logo/Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl" style={{ background: "var(--color-accent-light)" }}>
          <svg className="h-10 w-10" style={{ color: "var(--color-accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
          </svg>
        </div>

        <h2 className="text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>
          Connect WhatsApp
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-tertiary)" }}>
          Scan the QR code with your phone or enter your number to connect.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Connected state — redirecting */}
        {(sessionInfo.status === "connected" || redirecting) && (
          <div className="mt-6 flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "var(--color-success-light)" }}>
              <svg className="h-8 w-8 text-emerald-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-sm font-semibold" style={{ color: "var(--color-success)" }}>Connected!</div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
              <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>Loading your chats...</p>
            </div>
          </div>
        )}

        {/* QR Code display */}
        {sessionInfo.status === "qr" && sessionInfo.qrCode && mode === "qr" && (
          <div className="mt-6">
            <div className="mx-auto w-64 h-64 rounded-2xl overflow-hidden border-2 p-2" style={{ borderColor: "var(--color-border-card)", background: "#fff" }}>
              <img src={sessionInfo.qrCode} alt="WhatsApp QR Code" className="w-full h-full" />
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              Open WhatsApp → Settings → Linked Devices → Link a Device
            </p>
          </div>
        )}

        {/* Pairing code display */}
        {sessionInfo.status === "qr" && sessionInfo.pairingCode && mode === "phone" && (
          <div className="mt-6">
            <div className="mx-auto rounded-2xl border-2 px-6 py-4" style={{ borderColor: "var(--color-accent)", background: "var(--color-accent-light)" }}>
              <div className="text-3xl font-mono font-bold tracking-[0.3em]" style={{ color: "var(--color-accent)" }}>
                {sessionInfo.pairingCode}
              </div>
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              Open WhatsApp → Settings → Linked Devices → Link with phone number → Enter this code
            </p>
          </div>
        )}

        {/* Connection form (only when disconnected) */}
        {sessionInfo.status === "disconnected" && (
          <div className="mt-6 space-y-4">
            {/* Mode toggle */}
            <div className="inline-flex rounded-xl p-1" style={{ background: "var(--color-surface-secondary)" }}>
              <button
                type="button"
                onClick={() => setMode("qr")}
                className={["rounded-lg px-4 py-2 text-xs font-semibold transition-all", mode === "qr" ? "bg-white text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"].join(" ")}
              >
                QR Code
              </button>
              <button
                type="button"
                onClick={() => setMode("phone")}
                className={["rounded-lg px-4 py-2 text-xs font-semibold transition-all", mode === "phone" ? "bg-white text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"].join(" ")}
              >
                Phone Number
              </button>
            </div>

            {mode === "phone" && (
              <input
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="e.g. 94760216497"
                className="w-full rounded-xl border px-4 py-3 text-center text-[16px] font-mono outline-none transition-colors"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface-secondary)", color: "var(--color-text-primary)" }}
              />
            )}

            <button
              type="button"
              onClick={() => void startSession()}
              disabled={loading || (mode === "phone" && !phoneInput.trim())}
              className="w-full rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))" }}
            >
              {loading ? "Connecting..." : mode === "qr" ? "Generate QR Code" : "Get Pairing Code"}
            </button>
          </div>
        )}

        {/* Connecting state */}
        {sessionInfo.status === "connecting" && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
            <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>Connecting to WhatsApp...</p>
          </div>
        )}

        {/* Disconnect button */}
        {(sessionInfo.status === "qr" || sessionInfo.status === "connected") && (
          <button
            type="button"
            onClick={() => void disconnect()}
            className="mt-4 text-xs font-medium underline transition-colors"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
