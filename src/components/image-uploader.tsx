"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/server/web/actions";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const WIDTHS = [320, 800, 1600];
const MAX_HEIGHT = 3000;

async function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function render(bmp: ImageBitmap, targets: number[], type: "image/webp" | "image/jpeg") {
  const out: { width: number; blob: Blob }[] = [];
  for (const target of targets) {
    const scale = Math.min(target / bmp.width, MAX_HEIGHT / bmp.height, 1);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    if (out.some((o) => o.width === w)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingQuality = "high";
    if (type === "image/jpeg") {
      ctx.fillStyle = "#ffffff"; // JPEG has no transparency
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await encode(canvas, type, type === "image/webp" ? 0.82 : 0.85);
    if (!blob || blob.type !== type) return null; // this browser cannot write this type
    out.push({ width: w, blob });
  }
  return out;
}

/**
 * Resizes one picture to the standard widths and re-encodes it (WebP, or JPEG where the browser cannot make WebP).
 * Re-encoding also removes camera metadata such as GPS location. Phone photos are turned upright first.
 */
export async function prepareImage(file: File): Promise<{ width: number; blob: Blob }[]> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const targets = [...new Set([...WIDTHS.filter((w) => w < bmp.width), Math.min(bmp.width, WIDTHS[WIDTHS.length - 1]!)])].sort((a, b) => a - b);
    const out = (await render(bmp, targets, "image/webp")) ?? (await render(bmp, targets, "image/jpeg"));
    if (!out) throw new Error("encode failed");
    return out;
  } finally {
    bmp.close();
  }
}

/**
 * Adds images to a product, category, brand or service page. Several pictures can be chosen at once; each is
 * prepared in the browser and uploaded separately. Without JavaScript the form posts one original file instead.
 */
export function ImageUploader({ action, ownerType, ownerId, defaultAlt, multiple = true }: { action: Action; ownerType: string; ownerId: string; defaultAlt: string; multiple?: boolean }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [progress, setProgress] = useState<{ busy: boolean; ok?: boolean; message?: string }>({ busy: false });
  const router = useRouter();
  const message = progress.message ?? state.message;
  const ok = progress.message ? progress.ok : state.ok;

  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      className="space-y-3"
      onSubmit={async (e) => {
        if (typeof createImageBitmap !== "function") return; // let the plain form post the original
        e.preventDefault();
        const form = e.currentTarget;
        const input = form.elements.namedItem("original") as HTMLInputElement;
        const alt = (form.elements.namedItem("alt") as HTMLInputElement).value;
        const files = Array.from(input.files ?? []);
        if (files.length === 0) return setProgress({ busy: false, ok: false, message: "Choose at least one picture." });
        const problems: string[] = [];
        let added = 0;
        for (const [i, file] of files.entries()) {
          setProgress({ busy: true, message: `Preparing and uploading ${i + 1} of ${files.length}…`, ok: true });
          let copies: { width: number; blob: Blob }[];
          try {
            copies = await prepareImage(file);
          } catch {
            problems.push(`${file.name}: this picture could not be read. Use JPEG, PNG or WebP (on iPhone, set the camera to "Most Compatible").`);
            continue;
          }
          const fd = new FormData();
          fd.set("ownerType", ownerType);
          fd.set("ownerId", ownerId);
          fd.set("alt", alt || defaultAlt);
          for (const c of copies) fd.append(`w${c.width}`, c.blob, `${c.width}.${c.blob.type === "image/webp" ? "webp" : "jpg"}`);
          const r = await action({ ok: false }, fd);
          if (r.ok) added++;
          else problems.push(`${file.name}: ${r.message ?? "upload failed."}`);
        }
        form.reset();
        setProgress({
          busy: false,
          ok: problems.length === 0,
          message: [added ? `${added} image${added === 1 ? "" : "s"} added.` : "", ...problems].filter(Boolean).join("\n"),
        });
        router.refresh();
      }}
    >
      <input type="hidden" name="ownerType" value={ownerType} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-sm">
          <span className="font-medium text-slate-800">Pictures</span>
          <input name="original" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple={multiple} required className="field mt-1" />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-800">Describe the picture</span>
          <input name="alt" className="field mt-1" maxLength={200} placeholder={defaultAlt} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={progress.busy} aria-disabled={progress.busy}>
          {progress.busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      <p className="text-xs text-slate-600">JPEG, PNG or WebP. Pictures are resized and compressed before upload, and location data is removed. The description helps blind visitors and search engines.</p>
      {message && (
        <p role={ok ? "status" : "alert"} className={`whitespace-pre-line rounded-md px-3 py-2 text-sm ${ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {message}
        </p>
      )}
    </form>
  );
}
