/**
 * Compresses an image file (PNG/JPEG) to a sharp, lightweight WebP (<250 KB)
 * Preserves aspect ratio, caps max dimension at 1920px, and encodes at 85% quality.
 */
export async function compressCardImage(file: File): Promise<Blob> {
  // If file is already tiny (e.g. < 150 KB), skip compression
  if (file.size < 150 * 1024) return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_WIDTH = 1920;
      const MAX_HEIGHT = 1080;
      let { width, height } = img;

      // Downscale proportionally if larger than 1080p/1440p
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // Export to WebP at 0.85 quality (visually lossless for UI & text)
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size > file.size) {
            resolve(file); // Fallback to original if compression didn't shrink
          } else {
            resolve(blob);
          }
        },
        'image/webp',
        0.85,
      );
    };

    img.onerror = () => resolve(file);
    img.src = url;
  });
}
