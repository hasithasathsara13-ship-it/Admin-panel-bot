"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getActiveShopId } from "../../lib/activeShopId";
import { toStorageSafeCategoryPath } from "../../lib/storageObjectKey";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { IconBox, IconTrash } from "../../components/ui/icons";
import { Skeleton } from "../../components/ui/skeleton";
import { Table, TableShell, Td, Th } from "../../components/ui/table";

const STORAGE_BUCKET_CANDIDATES = [
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET,
  "product-images",
  "New product",
]
  .filter((value): value is string => Boolean(value && value.trim()))
  .map((value) => value.trim());
const MAX_PRODUCT_IMAGES = 4;

type ProductRow = {
  id: string | number;
  name: string | null;
  description: string | null;
  price: number | null;
  stock_count: number | null;
  is_featured: boolean | null;
  category: string | null;
  images: string[];
  created_at: string | null;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "featured" | "sale" | "out">("all");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [savingId, setSavingId] = useState<string | number | null>(null);

  // Reviews state
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewImages, setReviewImages] = useState<{ id: string; image_url: string }[]>([]);
  const [reviewsLink, setReviewsLink] = useState("");
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsSaving, setReviewsSaving] = useState(false);
  const [reviewUploading, setReviewUploading] = useState(false);
  const MAX_REVIEW_IMAGES = 6;

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formStock, setFormStock] = useState("");
  const [formUnlimited, setFormUnlimited] = useState(false);
  const [formFeatured, setFormFeatured] = useState(false);
  const [formImages, setFormImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  function mapRawToProduct(raw: Record<string, unknown>): ProductRow {
    return {
      id: String(raw.id ?? ""),
      name: (raw.name as string | null | undefined) ?? null,
      description: (raw.description as string | null | undefined) ?? null,
      price: Number.isFinite(Number(raw.price)) ? Number(raw.price) : null,
      stock_count:
        raw.stock_count === null || raw.stock_count === undefined
          ? null
          : Number.isFinite(Number(raw.stock_count))
            ? Number(raw.stock_count)
            : null,
      is_featured:
        raw.is_featured === null || raw.is_featured === undefined
          ? null
          : Boolean(raw.is_featured),
      category: (raw.category as string | null | undefined) ?? null,
      images: Array.isArray(raw.images)
        ? raw.images
            .map((img) => (typeof img === "string" ? img.trim() : ""))
            .filter(Boolean)
        : [],
      created_at: (raw.created_at as string | null | undefined) ?? null,
    };
  }

  function ProductAvatar({ name }: { name: string | null }) {
    const letters =
      (name ?? "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase() || "P";

    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-accent-light)] to-transparent text-xs font-semibold text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-border-card)]">
        {letters}
      </div>
    );
  }

  function ProductsSkeleton() {
    return (
      <TableShell>
        <Table>
          <thead className="border-b border-gray-200/50 bg-gray-50/60">
            <tr>
              <Th>Product</Th>
              <Th>Price</Th>
              <Th>Stock</Th>
              <Th>Badges</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? "bg-white/50" : "bg-gray-50/30"}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-xl" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-40 rounded" />
                      <Skeleton className="h-3 w-24 rounded" />
                    </div>
                  </div>
                </Td>
                <Td>
                  <Skeleton className="h-4 w-20 rounded" />
                </Td>
                <Td>
                  <Skeleton className="h-4 w-16 rounded" />
                </Td>
                <Td>
                  <Skeleton className="h-6 w-28 rounded-full" />
                </Td>
                <Td className="text-right">
                  <Skeleton className="ml-auto h-9 w-10 rounded-lg" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableShell>
    );
  }

  async function loadProducts() {
    if (!supabase) {
      setError(
        "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
      setLoading(false);
      return;
    }

    const shopId = getActiveShopId();
    if (!shopId) {
      setError("No shop selected. Please login again.");
      setProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("shop_id", shopId);

    if (error) {
      setError(error.message);
      setProducts([]);
      setLoading(false);
      return;
    }

    const mapped = ((data ?? []) as Record<string, unknown>[]).map(mapRawToProduct);
    setProducts(mapped);
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteProduct(productId: string | number) {
    if (!supabase) return;

    const shopId = getActiveShopId();
    if (!shopId) return;

    setDeletingId(productId);
    setError(null);

    // Find product images to delete from storage
    const product = products.find((p) => p.id === productId);
    const imagesToDelete = product?.images ?? [];

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("shop_id", shopId)
      .eq("id", productId);

    if (error) {
      setError(error.message);
      setDeletingId(null);
      return;
    }

    // Delete product images from storage
    for (const url of imagesToDelete) {
      void deleteStorageFile(url);
    }

    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeletingId(null);
  }

  function startEdit(product: ProductRow) {
    setEditing(product);
    setFormName(product.name ?? "");
    setFormDescription(product.description ?? "");
    setFormCategory(product.category ?? "");
    setFormPrice(product.price === null ? "" : String(product.price));
    setFormStock(product.stock_count === null ? "" : String(product.stock_count));
    setFormUnlimited(product.stock_count === null);
    setFormFeatured(Boolean(product.is_featured));
    setFormImages(product.images);
    setError(null);
  }

  function removeImageAt(index: number) {
    const url = formImages[index];
    if (url && supabase) {
      // Delete from Supabase Storage
      void deleteStorageFile(url);
    }
    setFormImages((prev) => prev.filter((_, i) => i !== index));
  }

  /** Extract bucket and path from a Supabase Storage public URL and delete the file. */
  async function deleteStorageFile(publicUrl: string) {
    if (!supabase) return;
    try {
      // URL format: https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
      const url = new URL(publicUrl);
      const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
      if (!match) return;
      const bucket = match[1];
      const path = decodeURIComponent(match[2]);
      await supabase.storage.from(bucket).remove([path]);
    } catch {
      // Silently fail — file might already be gone
    }
  }

  async function uploadImages(files: File[]) {
    if (!supabase || files.length === 0) return;

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      throw new Error("Your login session expired. Please log in again, then retry image upload.");
    }

    const urls: string[] = [];
    for (const file of files) {
      const safeCategory = toStorageSafeCategoryPath(formCategory);
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const fileName = `${crypto.randomUUID()}.${ext}`;
      const path = `${safeCategory}/${fileName}`;

      let uploaded = false;
      let lastError: string | null = null;

      for (const bucket of STORAGE_BUCKET_CANDIDATES) {
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: false });

        if (uploadError) {
          lastError = uploadError.message;
          continue;
        }

        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        if (!data.publicUrl) {
          lastError = `Upload succeeded but no public URL from bucket: ${bucket}`;
          continue;
        }

        urls.push(data.publicUrl);
        uploaded = true;
        break;
      }

      if (!uploaded) {
        throw new Error(lastError ?? "Image upload failed. Check storage bucket and RLS policies.");
      }
    }

    setFormImages((prev) => {
      const merged = [...prev];
      for (const url of urls) {
        if (!merged.includes(url)) merged.push(url);
      }
      return merged;
    });
  }

  async function onSelectImages(files: File[]) {
    const onlyImages = files.filter((f) => f.type.startsWith("image/"));
    if (onlyImages.length === 0) return;
    const availableSlots = Math.max(0, MAX_PRODUCT_IMAGES - formImages.length);
    if (availableSlots <= 0) {
      setError(`Maximum ${MAX_PRODUCT_IMAGES} images allowed per product.`);
      return;
    }
    const filesToUpload = onlyImages.slice(0, availableSlots);
    if (onlyImages.length > filesToUpload.length) {
      setError(`Only ${MAX_PRODUCT_IMAGES} images are allowed per product.`);
    } else {
      setError(null);
    }
    setUploadingImages(true);
    try {
      await uploadImages(filesToUpload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload images.";
      setError(message);
    } finally {
      setUploadingImages(false);
    }
  }

  async function saveEdit() {
    if (!editing || !supabase) return;

    const shopId = getActiveShopId();
    if (!shopId) {
      setError("No shop selected. Please login again.");
      return;
    }

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setError("Product name is required.");
      return;
    }

    const priceNumber = Number(formPrice);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      setError("Price must be a valid number.");
      return;
    }

    const stockNumber = Number(formStock);
    if (!formUnlimited && (!Number.isFinite(stockNumber) || stockNumber < 0)) {
      setError("Stock must be a valid number or set unlimited stock.");
      return;
    }

    setSavingId(editing.id);
    setError(null);

    const payload = {
      name: trimmedName,
      description: formDescription.trim() || null,
      category: formCategory.trim() || null,
      price: priceNumber,
      stock_count: formUnlimited ? null : Math.trunc(stockNumber),
      is_featured: formFeatured,
      images: formImages,
    };

    const { data, error } = await supabase
      .from("products")
      .update(payload)
      .eq("shop_id", shopId)
      .eq("id", editing.id)
      .select("*")
      .single();

    if (error) {
      setError(error.message);
      setSavingId(null);
      return;
    }

    const updated = mapRawToProduct((data ?? {}) as Record<string, unknown>);
    setProducts((prev) => prev.map((p) => (p.id === editing.id ? updated : p)));
    setEditing(null);
    setSavingId(null);
  }

  // ── Reviews functions ────────────────────────────────────────────────────
  async function loadReviews() {
    if (!supabase) return;
    const shopId = getActiveShopId();
    if (!shopId) return;
    setReviewsLoading(true);

    const { data: reviewRows } = await supabase
      .from("reviews")
      .select("id, image_url")
      .eq("shop_id", shopId)
      .order("sort_order", { ascending: true });

    setReviewImages((reviewRows ?? []) as { id: string; image_url: string }[]);

    const { data: bizRow } = await supabase
      .from("businesses")
      .select("reviews_link")
      .eq("id", shopId)
      .maybeSingle();

    setReviewsLink((bizRow as { reviews_link?: string | null })?.reviews_link ?? "");
    setReviewsLoading(false);
  }

  async function uploadReviewImage(file: File) {
    if (!supabase) return;
    const shopId = getActiveShopId();
    if (!shopId) return;
    if (reviewImages.length >= MAX_REVIEW_IMAGES) {
      setError(`Maximum ${MAX_REVIEW_IMAGES} review images allowed.`);
      return;
    }

    setReviewUploading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Session expired. Please login again.");

      const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
      const fileName = `reviews/${shopId}/${crypto.randomUUID()}.${ext}`;

      let uploaded = false;
      let publicUrl = "";

      for (const bucket of STORAGE_BUCKET_CANDIDATES) {
        const { error: uploadErr } = await supabase.storage
          .from(bucket)
          .upload(fileName, file, { upsert: false });
        if (uploadErr) continue;

        const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
        if (data.publicUrl) {
          publicUrl = data.publicUrl;
          uploaded = true;
          break;
        }
      }

      if (!uploaded || !publicUrl) throw new Error("Image upload failed. Check storage bucket.");

      const { data: inserted, error: insertErr } = await supabase
        .from("reviews")
        .insert({ shop_id: shopId, image_url: publicUrl, sort_order: reviewImages.length })
        .select("id, image_url")
        .single();

      if (insertErr) throw new Error(insertErr.message);

      setReviewImages((prev) => [...prev, inserted as { id: string; image_url: string }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload review image.");
    } finally {
      setReviewUploading(false);
    }
  }

  async function deleteReviewImage(reviewId: string) {
    if (!supabase) return;
    const shopId = getActiveShopId();
    if (!shopId) return;

    // Find the image URL before deleting the row
    const review = reviewImages.find((r) => r.id === reviewId);

    const { error: delErr } = await supabase
      .from("reviews")
      .delete()
      .eq("id", reviewId)
      .eq("shop_id", shopId);

    if (delErr) {
      setError(delErr.message);
      return;
    }

    // Delete the actual file from storage
    if (review?.image_url) {
      void deleteStorageFile(review.image_url);
    }

    setReviewImages((prev) => prev.filter((r) => r.id !== reviewId));
  }

  async function saveReviewsLink() {
    if (!supabase) return;
    const shopId = getActiveShopId();
    if (!shopId) return;

    setReviewsSaving(true);
    setError(null);

    const { error: updateErr } = await supabase
      .from("businesses")
      .update({ reviews_link: reviewsLink.trim() || null })
      .eq("id", shopId);

    if (updateErr) {
      setError(updateErr.message);
    }
    setReviewsSaving(false);
  }

  useEffect(() => {
    if (reviewsOpen) {
      void loadReviews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewsOpen]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      const name = (p.name ?? "").toLowerCase();
      const category = (p.category ?? "").toLowerCase();
      const matchesSearch = !q || name.includes(q) || category.includes(q);

      const stock = Number(p.stock_count ?? 0);
      const out = p.stock_count !== null && Number.isFinite(stock) && stock <= 0;
      const featured = Boolean(p.is_featured);
      const sale =
        // Flexible sale detection: supports boolean `is_on_sale` if present in DB later.
        Boolean((p as unknown as { is_on_sale?: boolean }).is_on_sale) ||
        (!featured && p.price !== null && p.price <= 5000);

      const matchesFilter =
        filter === "all" ||
        (filter === "featured" && featured) ||
        (filter === "sale" && sale) ||
        (filter === "out" && out);

      return matchesSearch && matchesFilter;
    });

    return list;
  }, [filter, products, search]);

  function formatCreatedAt(value: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString();
  }

  return (
    <div className="space-y-6 theme-section-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
            Categories
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">Discover and manage your catalog.</p>
        </div>
        <div className="flex gap-2 shrink-0 sm:self-start">
          <Button variant="ghost" onClick={() => setReviewsOpen(true)} className="border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100">
            ⭐ Reviews
          </Button>
          <Link href="/add-product">
            <Button className="w-full sm:w-auto">+ Add Product</Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      )}

      {loading ? (
        <ProductsSkeleton />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          icon={<IconBox className="h-6 w-6" />}
          title="No products found"
          description="Try changing filters or add a new product."
        />
      ) : (
        <Card className="p-0">
          <div className="space-y-4 border-b border-[var(--color-border-card)] px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl bg-[var(--color-surface-hover)] p-1 backdrop-blur-sm">
                {[
                  { key: "all", label: `All Product (${products.length})` },
                  { key: "featured", label: "Featured Products" },
                  { key: "sale", label: "On Sale" },
                  { key: "out", label: "Out of Stock" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key as typeof filter)}
                    className={[
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                      filter === item.key
                        ? "bg-[var(--color-surface)] text-[var(--color-accent)] shadow-sm ring-1 ring-inset ring-[var(--color-border-card)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                    ].join(" ")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex w-full max-w-sm items-center rounded-xl border border-[var(--panel-border-soft)] bg-[var(--panel-input-bg)] px-3 transition-all duration-200 focus-within:border-[var(--color-accent)] focus-within:bg-[var(--panel-input-focus-bg)] focus-within:ring-2 focus-within:ring-[var(--color-accent-glow)]">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-[var(--panel-icon)]"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your product"
                  className="h-10 w-full bg-transparent px-2 text-sm text-[var(--color-text-primary)] outline-none"
                />
              </div>
            </div>
          </div>

          <TableShell className="rounded-t-none border-0 shadow-none">
            <Table>
              <thead className="theme-table-head">
                <tr>
                  <Th>No.</Th>
                  <Th>Product</Th>
                  <Th>Created Date</Th>
                  <Th>Stock</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-card)]">
                {filteredProducts.map((p, idx) => {
                  const isDeleting = deletingId === p.id;
                  const stock = Number(p.stock_count ?? 0);
                  const outOfStock =
                    p.stock_count !== null && Number.isFinite(stock) && stock <= 0;
                  const lowStock =
                    p.stock_count !== null &&
                    Number.isFinite(stock) &&
                    stock > 0 &&
                    stock < 5;

                  return (
                    <tr key={String(p.id)} className="theme-row-alt text-[var(--color-text-secondary)] transition-colors duration-200">
                      <Td className="font-medium text-[var(--color-text-secondary)]">{idx + 1}</Td>
                      <Td>
                        <div className="flex items-center gap-3">
                          <ProductAvatar name={p.name} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-[var(--color-text-primary)]">
                              {p.name ?? "—"}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                              {p.category ?? "General"}
                            </div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {formatCreatedAt(p.created_at)}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span>{p.stock_count === null ? "Unlimited" : (p.stock_count ?? "—")}</span>
                          {p.is_featured ? (
                            <Badge variant="featured">Featured</Badge>
                          ) : null}
                          {outOfStock ? (
                            <Badge variant="outOfStock">Out of stock</Badge>
                          ) : null}
                          {lowStock ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 border border-amber-200 bg-amber-50 px-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-100"
                              title="Stock is below 5 units"
                            >
                              Low Stock
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(p)}
                            className="h-8 w-8 px-0"
                            aria-label="Edit product"
                            title="Edit"
                          >
                            ✎
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteProduct(p.id)}
                            disabled={isDeleting}
                            className="h-8 w-8 px-0 text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]"
                            aria-label="Delete product"
                            title="Delete"
                          >
                            <IconTrash className="h-4 w-4" />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableShell>
        </Card>
      )}

      {editing ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 backdrop-blur-sm p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--color-border-card)] bg-[var(--panel-bg-strong)] p-6 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Edit Product</h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Update details and save to Supabase.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-card)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                onClick={() => setEditing(null)}
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-600">Product Name</span>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-600">Category</span>
                <input
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-600">Price</span>
                <input
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  inputMode="decimal"
                  className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-600">Stock</span>
                <input
                  value={formStock}
                  onChange={(e) => setFormStock(e.target.value)}
                  inputMode="numeric"
                  disabled={formUnlimited}
                  className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400 disabled:bg-zinc-100"
                />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-zinc-600">Description</span>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 outline-none focus:border-zinc-400"
                />
              </label>
              <div className="grid gap-2 text-sm md:col-span-2">
                <span className="text-zinc-600">Product Images</span>
                {formImages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-5 text-center text-xs text-zinc-500">
                    No product images added
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {formImages.map((url, idx) => (
                      <div key={`${url}-${idx}`} className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                        <div className="aspect-square overflow-hidden rounded-lg bg-white">
                          <img
                            src={url}
                            alt={`Product image ${idx + 1}`}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-zinc-500">Image {idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeImageAt(idx)}
                            className="rounded px-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-xs text-zinc-500">
                  Images: {formImages.length}/{MAX_PRODUCT_IMAGES}
                </div>
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    void onSelectImages(Array.from(e.dataTransfer.files ?? []));
                  }}
                  className={[
                    "rounded-xl border border-dashed px-3 py-4 text-center text-sm transition",
                    dragActive
                      ? "border-blue-400 bg-blue-50 text-blue-700"
                      : "border-zinc-300 bg-zinc-50 text-zinc-600",
                  ].join(" ")}
                >
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => void onSelectImages(Array.from(e.target.files ?? []))}
                  />
                  {uploadingImages
                    ? "Uploading images..."
                    : "Drag & drop images here, or click to select files (max 4 total)"}
                </label>
                <div className="flex items-center justify-end">
                  <input
                    type="file"
                    id="edit-product-image-upload"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => void onSelectImages(Array.from(e.target.files ?? []))}
                  />
                  <Button type="button" variant="ghost" disabled={uploadingImages}>
                    <label htmlFor="edit-product-image-upload" className="cursor-pointer">
                      Select Images
                    </label>
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-zinc-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formUnlimited}
                  onChange={(e) => setFormUnlimited(e.target.checked)}
                />
                Unlimited Stock
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formFeatured}
                  onChange={(e) => setFormFeatured(e.target.checked)}
                />
                Featured Product
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={savingId === editing.id || uploadingImages}>
                {savingId === editing.id ? "Saving..." : uploadingImages ? "Uploading..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reviews Modal */}
      {reviewsOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 backdrop-blur-sm p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--color-border-card)] bg-[var(--panel-bg-strong)] p-6 shadow-2xl backdrop-blur-xl max-h-[90vh] overflow-y-auto">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">⭐ Customer Reviews</h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Upload up to 6 review screenshots and optionally add your reviews page link.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-card)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                onClick={() => setReviewsOpen(false)}
              >
                Close
              </button>
            </div>

            {reviewsLoading ? (
              <div className="flex items-center justify-center py-10 text-sm text-zinc-500">Loading reviews...</div>
            ) : (
              <>
                {/* Review Images Grid */}
                <div className="grid gap-3 text-sm">
                  <span className="font-medium text-zinc-600">Review Screenshots ({reviewImages.length}/{MAX_REVIEW_IMAGES})</span>
                  {reviewImages.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-8 text-center text-xs text-zinc-500">
                      No review screenshots added yet. Upload images of customer reviews.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {reviewImages.map((review, idx) => (
                        <div key={review.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                          <div className="aspect-square overflow-hidden rounded-lg bg-white">
                            <img
                              src={review.image_url}
                              alt={`Review ${idx + 1}`}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-zinc-500">Review {idx + 1}</span>
                            <button
                              type="button"
                              onClick={() => void deleteReviewImage(review.id)}
                              className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {reviewImages.length < MAX_REVIEW_IMAGES && (
                    <label className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-center text-sm text-zinc-600 cursor-pointer hover:border-amber-400 hover:bg-amber-50/50 transition">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadReviewImage(file);
                          e.currentTarget.value = "";
                        }}
                      />
                      {reviewUploading ? "Uploading..." : "Click to upload a review screenshot"}
                    </label>
                  )}
                </div>

                {/* Reviews Link Section */}
                <div className="mt-6 grid gap-2 text-sm">
                  <span className="font-medium text-zinc-600">Reviews Link (optional)</span>
                  <p className="text-xs text-zinc-500">
                    Add your Facebook page reviews link, Google reviews link, or any external reviews page.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={reviewsLink}
                      onChange={(e) => setReviewsLink(e.target.value)}
                      placeholder="https://www.facebook.com/yourpage/reviews"
                      className="h-10 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400 text-sm"
                    />
                    <Button
                      onClick={() => void saveReviewsLink()}
                      disabled={reviewsSaving}
                    >
                      {reviewsSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

