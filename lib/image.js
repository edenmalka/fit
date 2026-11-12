// Turns any photo the browser gets (JPEG, PNG, WebP, AVIF, HEIC…) into a PNG,
// shrunk so the longest side is at most MAX px (TRELLIS works at ~518 px anyway).

const MAX = 1024;
// Pinned. Only loaded when the browser can't open a HEIC photo by itself (e.g. Chrome).
const HEIC_LIB = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';

function isHeic(file) {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
}

async function decode(blob) {
  // createImageBitmap respects the photo's rotation (EXIF) in current browsers.
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function toPng(file) {
  let bitmap;
  try {
    bitmap = await decode(file);
  } catch (err) {
    if (!isHeic(file)) throw err;
    if (!window.heic2any) await loadScript(HEIC_LIB);
    const jpeg = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    bitmap = await decode(Array.isArray(jpeg) ? jpeg[0] : jpeg);
  }

  const w0 = bitmap.width, h0 = bitmap.height;
  const k = Math.min(1, MAX / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * k);
  canvas.height = Math.round(h0 * k);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!png) throw new Error('png encode failed');
  return png;
}
