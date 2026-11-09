/**
 * Makes a picked image small enough to upload as a logo: at most `maxSide` pixels on the longer side,
 * PNG to keep a transparent background, or WebP if the PNG is still too big.
 * Phone photos are often several MB; the API accepts up to 512 KB.
 */
export async function shrinkImage(file: File, maxSide = 512, maxBytes = 500 * 1024): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG or WebP).');

  const bitmap = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const png = await toBlob(canvas, 'image/png');
  if (png.size <= maxBytes) return png;
  for (const quality of [0.9, 0.75, 0.6]) {
    const webp = await toBlob(canvas, 'image/webp', quality);
    if (webp.type === 'image/webp' && webp.size <= maxBytes) return webp;
  }
  throw new Error('This image is too large. Try a simpler logo.');
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image couldn't be opened. Try a PNG or JPG."));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This image couldn't be prepared."))), type, quality),
  );
}
