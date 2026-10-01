/**
 * Utility for cropping Region-of-Interest (ROI) from CEU Makati Oral Diagnosis Forms (ODF)
 * Uses client-side HTML5 Canvas (100% free, zero external API cost, no server needed)
 */

export const ODF_CROP_PRESETS = {
  // Page 1: "C. Mouth Examination" (Odontogram with permanent & deciduous dentition)
  PAGE_1_ODONTOGRAM: {
    name: "Odontogram (Mouth Examination)",
    xPercent: 0.04,
    yPercent: 0.52,
    widthPercent: 0.92,
    heightPercent: 0.43,
  },
  // Page 2: "Data Privacy Act Statement Policy & Dental Procedure Consent Form"
  PAGE_2_CONSENT: {
    name: "Signed Consent & Data Privacy Policy",
    xPercent: 0.04,
    yPercent: 0.50,
    widthPercent: 0.92,
    heightPercent: 0.44,
  },
};

/**
 * Loads an image file into an HTMLImageElement
 */
export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (_err) => reject(new Error("Failed to load image for cropping"));

    if (typeof fileOrUrl === "string") {
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof Blob || fileOrUrl instanceof File) {
      img.src = URL.createObjectURL(fileOrUrl);
    } else {
      reject(new Error("Invalid image source provided"));
    }
  });
}

/**
 * Crops a designated rectangular region from an image source
 * @param {File|Blob|string|HTMLImageElement} source
 * @param {object} rect - { xPercent, yPercent, widthPercent, heightPercent }
 * @returns {Promise<{ dataUrl: string, blob: Blob, width: number, height: number }>}
 */
export async function cropImageRegion(source, rect) {
  const img = source instanceof HTMLImageElement ? source : await loadImage(source);

  const x = Math.max(0, rect.xPercent * img.naturalWidth);
  const y = Math.max(0, rect.yPercent * img.naturalHeight);
  const width = Math.min(img.naturalWidth - x, rect.widthPercent * img.naturalWidth);
  const height = Math.min(img.naturalHeight - y, rect.heightPercent * img.naturalHeight);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not initialize 2D canvas context");

  // High quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    img,
    x,
    y,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
  });

  return {
    dataUrl,
    blob,
    width: canvas.width,
    height: canvas.height,
  };
}
