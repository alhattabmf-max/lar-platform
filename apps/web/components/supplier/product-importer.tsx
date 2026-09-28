"use client";

import { useState } from "react";
import Link from "next/link";
import type { TaxonomyNodeItem } from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { parseProductImport, productImportTemplate, type ProductImportRow } from "@/lib/product-import";
import { Button } from "@/components/ui/button";

interface RowProgress { id?: string; uploaded?: boolean; done?: boolean; error?: string }

export function ProductImporter({
  locale, taxonomy, labels,
}: {
  locale: string;
  taxonomy: TaxonomyNodeItem[];
  labels: Record<string, string>;
}) {
  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<number, RowProgress>>({});
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  function downloadTemplate() {
    const href = URL.createObjectURL(new Blob(["\uFEFF" + productImportTemplate()], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "lar-products-template.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  async function selectCsv(file?: File) {
    setRows([]);
    setProgress({});
    setProblem("");
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(labels.fileTooLarge);
      const parsed = parseProductImport(await file.text(), new Set(taxonomy.map((node) => node.id)));
      setRows(parsed);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  async function importRows() {
    if (busy) return;
    setProblem("");
    const photoMap = new Map<string, File>();
    for (const photo of photos) {
      if (photoMap.has(photo.name)) { setProblem(labels.duplicateImage + ": " + photo.name); return; }
      photoMap.set(photo.name, photo);
    }
    const missing = rows.flatMap((row) => row.imageNames).find((name) => !photoMap.has(name));
    if (missing) { setProblem(labels.missingImage + ": " + missing); return; }
    setBusy(true);
    // A created row keeps its server id if a later image fails. Retry resumes
    // that row instead of creating a duplicate product.
    const next = { ...progress };
    try {
      for (const row of rows) {
        const current = next[row.line] ?? {};
        if (current.done) continue;
        try {
          const id = current.id ?? (await apiClient.post<{ id: string }>("/companies/me/products", row.product)).id;
          next[row.line] = { id };
          setProgress({ ...next });
          for (const name of current.uploaded ? [] : row.imageNames) {
            // A retry after an uncertain upload must not silently duplicate
            // an image. Stop and let the supplier inspect the saved draft.
            if (current.id && current.error) throw new Error(labels.inspectDraft);
            await uploadFile(`/companies/me/products/${id}/media`, photoMap.get(name)!, "file");
          }
          next[row.line] = { id, uploaded: true };
          setProgress({ ...next });
          await apiClient.post(`/companies/me/products/${id}/submit`);
          next[row.line] = { id, done: true };
        } catch (error) {
          next[row.line] = { ...next[row.line], error: error instanceof Error ? error.message : String(error) };
        }
        setProgress({ ...next });
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-content-muted">{labels.help}</p>
      <Button type="button" variant="ghost" onClick={downloadTemplate}>{labels.template}</Button>
      <div className="rounded-card border border-line p-4">
        <h2 className="font-semibold">{labels.categories}</h2>
        <ul className="mt-2 max-h-44 overflow-auto text-sm">
          {taxonomy.map((node) => <li key={node.id}><span>{locale === "ar-SA" ? node.nameAr : node.nameEn}</span> <code dir="ltr" className="select-all">{node.id}</code></li>)}
        </ul>
      </div>
      <label className="text-sm font-medium">{labels.csv}<input type="file" accept=".csv,text/csv" className="mt-2 block" disabled={busy} onChange={(event) => void selectCsv(event.target.files?.[0])} /></label>
      <label className="text-sm font-medium">{labels.photos}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-2 block" disabled={busy} onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} /></label>
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      {rows.length > 0 && <>
        <p className="text-sm">{labels.ready}: {rows.length}</p>
        <ul className="max-h-72 overflow-auto divide-y divide-line rounded-card border border-line">
          {rows.map((row) => <li key={row.line} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span>{row.line}. {locale === "ar-SA" ? row.product.nameAr : row.product.nameEn} ({row.imageNames.length})</span>
            {progress[row.line]?.id && <Link href={`/${locale}/supplier/products/${progress[row.line].id}`} className="underline">{labels.view}</Link>}
            <span role={progress[row.line]?.error ? "alert" : undefined}>{progress[row.line]?.error ?? (progress[row.line]?.done ? labels.saved : "")}</span>
          </li>)}
        </ul>
        <Button type="button" disabled={busy || rows.every((row) => progress[row.line]?.done)} onClick={() => void importRows()}>{busy ? labels.importing : labels.import}</Button>
      </>}
    </div>
  );
}
