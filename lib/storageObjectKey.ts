export function toStorageSafeCategoryPath(
  input: string,
  fallback = "uncategorized",
): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return fallback;

  const segments = normalized
    .split(">")
    .map((segment) =>
      segment
        .trim()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter(Boolean);

  return segments.length > 0 ? segments.join("/") : fallback;
}
