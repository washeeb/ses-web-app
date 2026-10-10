"use client";

import { useState, useTransition } from "react";
import { importProducts, type ImportResult } from "./actions";

const ACTION_LABEL: Record<string, string> = {
  create_product: "New product",
  add_option: "New option",
  update: "Update",
  unchanged: "No change",
  error: "Error — skipped",
};

/** Two steps: preview (nothing changes), then apply. The server re-validates on apply. */
export function Importer() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const run = (apply: boolean) => start(async () => setResult(await importProducts(text, apply)));
  const preview = result?.ok && result.mode === "preview" ? result.rows : null;
  const errors = preview?.filter((r) => r.action === "error").length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label" htmlFor="csv">CSV file</label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          className="block text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setResult(null);
            if (!f) return;
            if (f.size > 1_000_000) {
              setResult({ ok: false, message: "The file is too large (max 1 MB)." });
              return;
            }
            setFileName(f.name);
            setText(await f.text());
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={!text || pending} onClick={() => run(false)}>
          {pending && !preview ? "Checking…" : "Preview changes"}
        </button>
        {preview && (
          <button type="button" className="btn btn-accent" disabled={pending} onClick={() => run(true)}>
            {pending ? "Importing…" : `Apply ${preview.filter((r) => r.action !== "error" && r.action !== "unchanged").length} change(s)`}
          </button>
        )}
      </div>
      <div aria-live="polite">
        {result && !result.ok && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{result.message}</p>}
        {result?.ok && result.mode === "apply" && (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Imported {fileName}: {result.summary.created} created, {result.summary.updated} updated, {result.summary.unchanged} unchanged, {result.summary.skipped} skipped
            {result.summary.approvals > 0 && `, ${result.summary.approvals} price change(s) sent for approval`}.
          </p>
        )}
        {preview && (
          <div className="-mx-5 overflow-x-auto">
            <p className="px-5 pb-2 text-sm text-slate-600">{preview.length} row(s){errors > 0 && `, ${errors} with errors (they will be skipped)`}. Nothing has changed yet.</p>
            <table className="table">
              <thead><tr><th>Row</th><th>SKU</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td className="font-mono text-xs">{r.sku}</td>
                    <td className={r.action === "error" ? "text-red-700" : ""}>{ACTION_LABEL[r.action]}</td>
                    <td className="text-xs">{[...r.errors, ...r.changes].join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
