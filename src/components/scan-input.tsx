"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector;
  }
}

/**
 * Text box for SKUs and barcodes. USB/Bluetooth scanners type the code and press Enter, so they work as they are.
 * On phones and browsers with the Barcode Detection API, "Use camera" reads the code with the camera and submits
 * the surrounding form. Nothing leaves the device: frames are decoded in the browser.
 */
export function ScanInput({ name = "code", label = "Scan or type a SKU or barcode", autoFocus = false, required = true }: { name?: string; label?: string; autoFocus?: boolean; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Feature detection only after hydration, so the server and first client render match.
  useEffect(() => {
    const id = requestAnimationFrame(() => setSupported(typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector!({ formats: ["code_128", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "code_39"] });
        while (!stop) {
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) {
            if (input.current) {
              input.current.value = found[0].rawValue;
              input.current.form?.requestSubmit();
            }
            setScanning(false);
            return;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch {
        setError("The camera could not be used. Allow camera access, or type the code.");
        setScanning(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="mt-1 flex gap-2">
          <input ref={input} name={name} className="field font-mono uppercase" autoComplete="off" autoCapitalize="characters" spellCheck={false} required={required} autoFocus={autoFocus} />
          {supported && (
            <button type="button" className="btn btn-ghost whitespace-nowrap" onClick={() => { setError(null); setScanning((s) => !s); }} aria-pressed={scanning}>
              {scanning ? "Stop camera" : "Use camera"}
            </button>
          )}
        </span>
      </label>
      {scanning && <video ref={video} className="aspect-video w-full max-w-sm rounded-lg bg-black object-cover" muted playsInline aria-label="Camera preview for scanning" />}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
