"use client";

/**
 * Read the text in a screenshot in the browser (Tesseract, no AI, nothing uploaded).
 * The image is cleaned up first: scaled so text is ~2x, made grayscale, and inverted
 * when it's a dark-mode dashboard, which is what OCR reads best.
 */
import type { OcrLine } from "@/lib/ocrRows";

export async function ocrImage(file: Blob, onProgress?: (p: number) => void): Promise<{ text: string; lines: OcrLine[] }> {
  const canvas = await prepare(file);
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  try {
    // one block of text, keeping each table row on its own line with its spacing
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    // blocks: every word with its box, so numbers can be matched to the heading above them
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const lines: OcrLine[] = (data.blocks ?? []).flatMap((b) =>
      b.paragraphs.flatMap((p) =>
        p.lines.map((l) => ({ words: l.words.map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 })) }))
      )
    );
    return { text: data.text, lines };
  } finally {
    await worker.terminate();
  }
}

async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  // small screenshots get upscaled (OCR wants ~30px tall text); huge ones are capped
  const up = bmp.width < 1600 ? Math.min(2.5, 2400 / bmp.width) : 1;
  const scale = Math.min(up, 4000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  // dark-mode dashboards: light text on dark → invert to dark text on light
  if (sum / (d.length / 4) < 110) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  // black-and-white at the best split point (Otsu): faint grey labels and anti-aliased
  // digits come out as crisp black text, which Tesseract reads far more reliably
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[d[i] | 0]++;
  const total = d.length / 4;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0, sumB = 0, best = 0, cut = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) { best = between; cut = t; }
  }
  // keep a little of the grey ramp so thin strokes don't break apart
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] > cut + 20 ? 255 : d[i] < cut - 20 ? 0 : d[i];
  ctx.putImageData(img, 0, 0);
  return c;
}
