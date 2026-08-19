/**
 * Shrinking photos before they're uploaded.
 *
 * A photo straight off a phone is 3–12MB and several thousand pixels wide.
 * Nothing in the app ever displays one larger than about 800px, so uploading
 * the original spends a minute of someone's data to deliver detail that is
 * thrown away on arrival — and anything over 10MB is refused by the API
 * outright, which used to fail the whole write-up along with it.
 *
 * Re-encoding to a long edge of 1600 and JPEG q0.82 turns a 6MB photo into
 * roughly 300KB, which is the difference between "it crashed" and "it posted".
 *
 * It degrades rather than throws. A browser that can't decode the format —
 * HEIC outside Safari, mainly — hands back the original file, which the API
 * still accepts.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;
/**
 * Below this, re-encoding costs more than it saves. Kept low on purpose: a
 * well-compressed 4000px photo can be only a few hundred KB, and gating on
 * bytes alone would send it up at full resolution for a UI that never shows one
 * above about 800. The size guard further down puts the original back whenever
 * re-encoding fails to help.
 */
const LEAVE_ALONE = 120 * 1024;

export async function shrinkForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= LEAVE_ALONE) return file;

  try {
    // `from-image` so a portrait photo doesn't come back on its side: EXIF
    // orientation is dropped when the pixels are redrawn.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    // A photo that's already small and well-compressed can come back bigger.
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

/**
 * Upload a queue of photos, a few at a time.
 *
 * Sequential uploads meant the fifth photo waited on the four before it for no
 * reason; two at once keeps a connection busy without holding more than two
 * decoded images in memory at any moment.
 *
 * A photo that fails doesn't take the others — or the write-up — with it. The
 * text is the point of a recommendation, and losing it because one image was
 * odd is the worst outcome available.
 */
/** Two at a time: enough to keep the connection busy, few enough that only two
 *  decoded bitmaps exist at once. */
const CONCURRENCY = 2;

export async function uploadPhotos(
  files: File[],
  upload: (file: File) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void
): Promise<{ failed: string[] }> {
  if (files.length === 0) return { failed: [] };

  const queue = [...files];
  const total = queue.length;
  const failed: string[] = [];
  let done = 0;

  // Each worker shrinks its own photo immediately before sending it. Shrinking
  // them all up front was the actual crash: decoding four 12-megapixel images
  // at once holds about 200MB of bitmaps, which a phone will not stand for.
  // Doing it inside the pool means at most `CONCURRENCY` are ever decoded, and
  // the first upload starts while the rest are still being read.
  const worker = async () => {
    for (;;) {
      const original = queue.shift();
      if (!original) return;
      try {
        await upload(await shrinkForUpload(original));
      } catch {
        failed.push(original.name);
      }
      onProgress?.(++done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  return { failed };
}
