export async function compressImageFile(file, { maxSize = 512, quality = 0.82 } = {}) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Choose a photo file.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Use a photo smaller than 10 MB.");
  }

  const image = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(image.src);
    throw new Error("Could not process that photo.");
  }
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(image.src);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo."));
    };
    image.src = url;
  });
}
