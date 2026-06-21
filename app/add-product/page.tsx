"use client";

import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { botSync } from "../../lib/botSync";
import { getActiveShopId } from "../../lib/activeShopId";
import { toStorageSafeCategoryPath } from "../../lib/storageObjectKey";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";

const MAX_PRODUCT_IMAGES = 4;

const STORAGE_BUCKET_CANDIDATES = [
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET,
  "product-images",
  "New product",
]
  .filter((value): value is string => Boolean(value && value.trim()))
  .map((value) => value.trim());

function buildStoragePolicySql(bucketNames: string[]): string {
  const uniqueBuckets = Array.from(new Set(bucketNames.filter(Boolean)));
  if (uniqueBuckets.length === 0) return "";
  const quotedBuckets = uniqueBuckets.map((bucket) => `'${bucket.replaceAll("'", "''")}'`).join(", ");
  return [
    "-- Run in Supabase SQL Editor",
    'drop policy if exists "product_images_select_policy" on storage.objects;',
    'drop policy if exists "product_images_insert_policy" on storage.objects;',
    `create policy "product_images_select_policy" on storage.objects for select to public using (bucket_id in (${quotedBuckets}));`,
    `create policy "product_images_insert_policy" on storage.objects for insert to authenticated with check (bucket_id in (${quotedBuckets}));`,
  ].join("\n");
}

function parseCommaList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isServiceBasedCategory(category: string) {
  const c = category.trim().toLowerCase();
  return c === "salon" || c === "service" || c === "services";
}

const PRODUCT_CATEGORY_OPTIONS = [
  "Fashion",
  "Shoes",
  "Electronics",
  "Beauty",
  "Home & Living",
  "Grocery",
  "Health",
  "Kids & Baby",
  "Sports",
  "Automotive",
];

const SERVICE_CATEGORY_OPTIONS = [
  "Salon",
  "Clinic",
  "Tuition",
  "Repair",
  "Cleaning",
  "Delivery",
  "Consulting",
  "Event Services",
  "Photography",
  "Other Service",
];

export default function AddProductPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [price, setPrice] = useState("");
  const [stockCount, setStockCount] = useState("");
  const [isUnlimitedStock, setIsUnlimitedStock] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);

  const [offeringType, setOfferingType] = useState<"product" | "service">("product");
  const [primaryCategory, setPrimaryCategory] = useState("");
  const [customPrimaryCategory, setCustomPrimaryCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [categoryTagsInput, setCategoryTagsInput] = useState("");

  const resolvedPrimaryCategory = useMemo(() => {
    if (primaryCategory === "__custom__") return customPrimaryCategory.trim();
    return primaryCategory.trim();
  }, [customPrimaryCategory, primaryCategory]);

  const category = useMemo(() => {
    const p = resolvedPrimaryCategory;
    const s = subcategory.trim();
    if (!p && !s) return "";
    if (!p) return s;
    if (!s) return p;
    return `${p} > ${s}`;
  }, [resolvedPrimaryCategory, subcategory]);

  const serviceBased = useMemo(
    () => offeringType === "service" || isServiceBasedCategory(category),
    [category, offeringType],
  );

  const [sizesInput, setSizesInput] = useState("");
  const [colorsInput, setColorsInput] = useState("");
  const [sizeChartImageFile, setSizeChartImageFile] = useState<File | null>(null);

  const [imageFiles, setImageFiles] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function removeImageAt(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadImages(files: File[]): Promise<string[]> {
    if (!supabase) {
      throw new Error(
        "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }

    if (files.length === 0) return [];

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      throw new Error("Your login session expired. Please log in again, then retry image upload.");
    }

    const urls: string[] = [];
    const attemptedBuckets = new Set<string>();
    for (const file of files) {
      const safeCategory = toStorageSafeCategoryPath(category);
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const fileName = `${crypto.randomUUID()}.${ext}`;
      const path = `${safeCategory}/${fileName}`;

      let uploaded = false;
      let lastError: string | null = null;

      for (const bucket of STORAGE_BUCKET_CANDIDATES) {
        attemptedBuckets.add(bucket);
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
        const baseError =
          lastError ??
          "Image upload failed. Check bucket name in NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET.";
        if (baseError.toLowerCase().includes("row-level security")) {
          const policySql = buildStoragePolicySql(Array.from(attemptedBuckets));
          throw new Error(
            `${baseError}\n\nStorage fix: add INSERT/SELECT policies on storage.objects for your product image bucket.\n\n${policySql}`,
          );
        }
        throw new Error(baseError);
      }
    }

    return urls;
  }

  async function onSubmit(e: React.FormEvent) {
    if (imageFiles.length > MAX_PRODUCT_IMAGES) {
      setError(`You can upload up to ${MAX_PRODUCT_IMAGES} images only.`);
      return;
    }

    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!supabase) {
      setError(
        "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
      return;
    }

    if (!name.trim()) {
      setError("Product Name is required.");
      return;
    }
    if (!resolvedPrimaryCategory) {
      setError("Primary category is required.");
      return;
    }

    const shopId = getActiveShopId();
    if (!shopId) {
      setError("No shop selected. Please login again.");
      return;
    }

    const priceNumber = Number(price);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      setError("Price must be a valid number (>= 0).");
      return;
    }

    const stockNumber = Number(stockCount);
    if (!isUnlimitedStock) {
      if (!Number.isFinite(stockNumber) || stockNumber < 0) {
        setError("Stock Count must be a valid number (>= 0), or enable Unlimited Stock.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const images = await uploadImages(imageFiles);
      const sizes = serviceBased ? [] : parseCommaList(sizesInput);
      const colors = serviceBased ? [] : parseCommaList(colorsInput);
      const categoryTags = parseCommaList(categoryTagsInput);
      const sizeChartImage =
        !serviceBased && sizeChartImageFile
          ? (await uploadImages([sizeChartImageFile]))[0] ?? null
          : null;

      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        shop_id: shopId,
        price: priceNumber,
        stock_count: isUnlimitedStock ? null : Math.trunc(stockNumber),
        is_featured: isFeatured,
        category: category.trim() || null,
        images,
        sizes,
        colors,
        offering_type: offeringType,
        subcategory: subcategory.trim() || null,
        category_tags: categoryTags,
        size_chart_image: sizeChartImage,
      };

      let { data: inserted, error: insertError } = await supabase
        .from("products")
        .insert(payload)
        .select("id,name,price,category")
        .single();

      if (
        insertError &&
        /offering_type|subcategory|category_tags|size_chart_image|column .* does not exist|schema cache/i.test(
          insertError.message,
        )
      ) {
        const fallbackPayload = {
          name: name.trim(),
          description: description.trim() || null,
          shop_id: shopId,
          price: priceNumber,
          stock_count: isUnlimitedStock ? null : Math.trunc(stockNumber),
          is_featured: isFeatured,
          category: category.trim() || null,
          images,
          sizes,
          colors,
        };
        const retry = await supabase
          .from("products")
          .insert(fallbackPayload)
          .select("id,name,price,category")
          .single();
        inserted = retry.data;
        insertError = retry.error;
      }
      if (insertError) throw insertError;

      if (inserted) {
        const event = botSync.NEW_PRODUCT_CREATED({
          product_id: (inserted as { id: string | number }).id,
          name: (inserted as { name: string | null }).name,
          price: (inserted as { price: number | null }).price,
          category: (inserted as { category: string | null }).category,
        });
        console.log(event);
      }

      setName("");
      setDescription("");
      setPrice("");
      setStockCount("");
      setIsUnlimitedStock(false);
      setIsFeatured(false);
      setOfferingType("product");
      setPrimaryCategory("");
      setCustomPrimaryCategory("");
      setSubcategory("");
      setCategoryTagsInput("");
      setSizesInput("");
      setColorsInput("");
      setSizeChartImageFile(null);
      setImageFiles([]);
      setSuccess("Product added successfully.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong while adding the product.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Add Product
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Fill in the details to list your item.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" form="add-product-form" disabled={submitting}>
            {submitting ? "Publishing..." : "Publish Product"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => {
              setName("");
              setDescription("");
              setPrice("");
              setStockCount("");
              setIsUnlimitedStock(false);
              setIsFeatured(false);
              setOfferingType("product");
              setPrimaryCategory("");
              setCustomPrimaryCategory("");
              setSubcategory("");
              setCategoryTagsInput("");
              setSizesInput("");
              setColorsInput("");
              setSizeChartImageFile(null);
              setImageFiles([]);
              setError(null);
              setSuccess(null);
            }}
          >
            Save to draft
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </div>
      )}

      <form id="add-product-form" onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-zinc-900">Basic Details</h2>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Product Name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                  placeholder="e.g. Nike Air Jordan 4"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Product Description
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-28 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 outline-none focus:border-zinc-400"
                  placeholder="Short product description..."
                />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-zinc-900">Pricing & Stock</h2>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Price
                </span>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                  placeholder="e.g. 230000"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Stock Count
                </span>
                <input
                  value={stockCount}
                  onChange={(e) => setStockCount(e.target.value)}
                  inputMode="numeric"
                  disabled={isUnlimitedStock}
                  className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400 disabled:bg-zinc-100"
                  placeholder={isUnlimitedStock ? "Unlimited" : "e.g. 20"}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={isUnlimitedStock}
                  onChange={(e) => setIsUnlimitedStock(e.target.checked)}
                />
                Unlimited Stock
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                />
                Feature on Home
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-zinc-900">Category & Variants</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Offering Type
                </span>
                <select
                  value={offeringType}
                  onChange={(e) => setOfferingType(e.target.value as "product" | "service")}
                  className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                >
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Primary Category
                  </span>
                  <select
                    value={primaryCategory}
                    onChange={(e) => setPrimaryCategory(e.target.value)}
                    className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                  >
                    <option value="">Select category</option>
                    {(offeringType === "service"
                      ? SERVICE_CATEGORY_OPTIONS
                      : PRODUCT_CATEGORY_OPTIONS
                    ).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value="__custom__">Custom category...</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Subcategory
                  </span>
                  <input
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                    placeholder="e.g. Sneakers / Hair Styling"
                  />
                </label>
              </div>

              {primaryCategory === "__custom__" ? (
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Custom Primary Category
                  </span>
                  <input
                    value={customPrimaryCategory}
                    onChange={(e) => setCustomPrimaryCategory(e.target.value)}
                    className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                    placeholder="Enter custom category"
                  />
                </label>
              ) : null}

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Category Tags (comma separated)
                </span>
                <input
                  value={categoryTagsInput}
                  onChange={(e) => setCategoryTagsInput(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                  placeholder="e.g. women, casual, premium"
                />
              </label>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                Final category path:{" "}
                <span className="font-semibold text-zinc-800">{category || "—"}</span>
              </div>

              {!serviceBased && (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Sizes (comma separated)
                      </span>
                      <input
                        value={sizesInput}
                        onChange={(e) => setSizesInput(e.target.value)}
                        className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                        placeholder="XS,S,M,L,XL"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Colors (comma separated)
                      </span>
                      <input
                        value={colorsInput}
                        onChange={(e) => setColorsInput(e.target.value)}
                        className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-zinc-400"
                        placeholder="black,white,red"
                      />
                    </label>
                  </div>

                  <label className="grid gap-1.5 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Size Chart Image (optional)
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setSizeChartImageFile(e.target.files?.[0] ?? null)}
                      className="block w-full rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-sm"
                    />
                    <div className="text-xs text-zinc-500">
                      {sizeChartImageFile
                        ? `Selected: ${sizeChartImageFile.name}`
                        : "No size chart image selected"}
                    </div>
                  </label>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-zinc-900">Product Image</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="grid gap-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Upload images
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []).slice(0, MAX_PRODUCT_IMAGES);
                    setImageFiles(selected);
                    if ((e.target.files?.length ?? 0) > MAX_PRODUCT_IMAGES) {
                      setError(`Only ${MAX_PRODUCT_IMAGES} images are allowed.`);
                    } else {
                      setError(null);
                    }
                  }}
                  className="block w-full rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-sm"
                />
              </label>

              <div className="grid grid-cols-3 gap-2">
                {imageFiles.length === 0 ? (
                  <>
                    <div className="col-span-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-xs text-zinc-500">
                      No image selected
                    </div>
                  </>
                ) : (
                  imageFiles.slice(0, MAX_PRODUCT_IMAGES).map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-600"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          className="rounded px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700"
                          onClick={() => removeImageAt(idx)}
                          aria-label={`Remove ${file.name}`}
                          title="Remove image"
                        >
                          x
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {imageFiles.length > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="neutral">
                    Selected: {imageFiles.length}/{MAX_PRODUCT_IMAGES} files
                  </Badge>
                  <button
                    type="button"
                    className="text-xs font-medium text-zinc-600 underline hover:text-zinc-900"
                    onClick={() => setImageFiles([])}
                  >
                    Deselect all
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-zinc-900">Quick Actions</h2>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button type="submit" form="add-product-form" className="w-full" disabled={submitting}>
                {submitting ? "Saving..." : "Add Product"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={submitting}
                onClick={() => {
                  setName("");
                  setDescription("");
                  setPrice("");
                  setStockCount("");
                  setIsUnlimitedStock(false);
                  setIsFeatured(false);
                  setOfferingType("product");
                  setPrimaryCategory("");
                  setCustomPrimaryCategory("");
                  setSubcategory("");
                  setCategoryTagsInput("");
                  setSizesInput("");
                  setColorsInput("");
                  setSizeChartImageFile(null);
                  setImageFiles([]);
                  setError(null);
                  setSuccess(null);
                }}
              >
                Reset Form
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}

