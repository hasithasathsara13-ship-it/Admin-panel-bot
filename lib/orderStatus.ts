export type NormalizedOrderStatus = "pending" | "delivered" | "other";

export function normalizeOrderStatus(value: unknown): NormalizedOrderStatus {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "pending") return "pending";
  if (s === "delivered") return "delivered";
  return "other";
}

