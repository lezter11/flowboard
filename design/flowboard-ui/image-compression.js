/* Client-side preview compression; retain the original on any failure. */
(function () {
  "use strict";
  function compressCardImage(file) {
    if (file.size < 150 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return Promise.resolve(file);
    return new Promise((resolve) => {
      let url;
      const finish = (result) => { if (url) URL.revokeObjectURL(url); url = null; resolve(result); };
      try {
        url = URL.createObjectURL(file);
        const image = new Image();
        image.onerror = () => finish(file);
        image.onload = () => {
          try {
            if (!image.width || !image.height) return finish(file);
            const scale = Math.min(1, 1920 / image.width, 1080 / image.height);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const context = canvas.getContext("2d");
            if (!context) return finish(file);
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => finish(blob && blob.type === "image/webp" && blob.size < file.size ? blob : file), "image/webp", 0.85);
          } catch (_) { finish(file); }
        };
        image.src = url;
      } catch (_) { finish(file); }
    });
  }
  window.compressCardImage = compressCardImage;
})();
