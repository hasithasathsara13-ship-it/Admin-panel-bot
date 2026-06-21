"use client";

export function getActiveShopId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("active_shop_id");
}

