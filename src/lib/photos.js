const TARGET_BYTES = 150 * 1024;
const HARD_CAP = 200 * 1024;
const ORIGINAL_EDGE = 4032;
const ORIGINAL_CAP = 6 * 1024 * 1024;

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/webp", quality);
  });
}

function drawScaled(source, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

export function browserSupportsWebp() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
}

export async function resizeToWebp(file) {
  if (!browserSupportsWebp()) {
    throw new Error("This browser cannot save WebP photos. Update iOS or use Chrome.");
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That photo could not be read. Use the camera button or choose a JPEG.");
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 1200 / longest);
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    let canvas = drawScaled(bitmap, width, height);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let quality = 0.82;
      while (quality >= 0.45) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob && blob.type === "image/webp" && blob.size <= TARGET_BYTES && blob.size <= HARD_CAP) {
          return blob;
        }
        quality -= 0.08;
      }
      width = Math.round(width * 0.8);
      height = Math.round(height * 0.8);
      if (width < 640 && height < 640) break;
      canvas = drawScaled(canvas, width, height);
    }
    throw new Error("A photo is still too big after shrinking. Try a different picture.");
  } finally {
    bitmap.close?.();
  }
}

// Full-resolution copy for social, with camera GPS stripped by redrawing.
// Returns null when the phone cannot make one under the storage cap.
export async function encodeOriginal(file) {
  if (!browserSupportsWebp()) return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, ORIGINAL_EDGE / longest);
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    let canvas = drawScaled(bitmap, width, height);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let quality = 0.86;
      while (quality >= 0.5) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob && blob.type === "image/webp" && blob.size <= ORIGINAL_CAP) return blob;
        quality -= 0.12;
      }
      width = Math.round(width * 0.8);
      height = Math.round(height * 0.8);
      if (width < 1600 && height < 1600) return null;
      canvas = drawScaled(canvas, width, height);
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}
