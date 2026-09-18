/**
 * Client-side browser background removal utility.
 * Uses @imgly/background-removal (WebAssembly + ONNX Web) if available,
 * with fallback methods (chroma key / edge flood & person silhouette approximation)
 * if CDN / WASM memory restricts in certain iframe environments.
 */
import { removeBackground as imglyRemoveBackground } from '@imgly/background-removal';

export interface BgRemovalProgress {
  status: 'loading_model' | 'processing' | 'done' | 'fallback' | 'error';
  progress: number;
  message: string;
}

export async function processBackgroundRemoval(
  imageSource: File | Blob | string,
  onProgress?: (info: BgRemovalProgress) => void
): Promise<string> {
  // Normalize the image to a generous high resolution (max 1200px)
  // to ensure crisp edges, high clarity, and fast client-side model execution.
  const normalizedBlob = await resizeImageToBlob(imageSource, 1200, 1200);

  try {
    if (onProgress) {
      onProgress({
        status: 'loading_model',
        progress: 15,
        message: 'AI 모델 로딩 중...',
      });
    }

    // Try @imgly/background-removal
    const blobResult = await imglyRemoveBackground(normalizedBlob, {
      progress: (key: string, current: number, total: number) => {
        if (onProgress && total > 0) {
          const pct = Math.min(90, Math.round((current / total) * 100));
          onProgress({
            status: 'processing',
            progress: pct,
            message: `고화질 배경 분리 계산 중 (${pct}%)...`,
          });
        }
      },
      model: 'isnet_quint8', // fastest quantized client-side model
      output: {
        format: 'image/png',
        quality: 0.92,
      },
    });

    if (onProgress) {
      onProgress({
        status: 'done',
        progress: 95,
        message: '초원 배치용 고화질 최적화 중...',
      });
    }

    const rawDataUrl = await blobToDataUrl(blobResult);
    const optimizedDataUrl = await trimAndOptimizeCutout(rawDataUrl, 900);

    if (onProgress) {
      onProgress({
        status: 'done',
        progress: 100,
        message: '배경 제거 완료!',
      });
    }

    return optimizedDataUrl;
  } catch (error) {
    console.warn('WASM / Neural model background removal failed, falling back to smart canvas removal:', error);
    if (onProgress) {
      onProgress({
        status: 'fallback',
        progress: 60,
        message: '대체 고속 필터로 배경 제거 중...',
      });
    }

    // Fallback: Smart canvas segmenter (contrast + corner-color flood / threshold transparency)
    const rawResult = await fallbackSmartRemoveBg(normalizedBlob);
    const optimizedResult = await trimAndOptimizeCutout(rawResult, 900);
    if (onProgress) {
      onProgress({
        status: 'done',
        progress: 100,
        message: '배경 제거 완료!',
      });
    }
    return optimizedResult;
  }
}

/**
 * Trims transparent borders and preserves sharp high-resolution quality.
 * Supports generous dimensions (up to 900px) with transparent WebP/PNG.
 */
export async function trimAndOptimizeCutout(
  dataUrl: string,
  maxDimension = 900
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) {
        resolve(dataUrl);
        return;
      }

      srcCtx.drawImage(img, 0, 0);
      const imgData = srcCtx.getImageData(0, 0, img.width, img.height);
      const data = imgData.data;

      // Find bounding box of non-transparent pixels (alpha > 12)
      let minX = img.width,
        minY = img.height,
        maxX = 0,
        maxY = 0;
      let hasVisiblePixels = false;

      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const alpha = data[(y * img.width + x) * 4 + 3];
          if (alpha > 15) {
            hasVisiblePixels = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (!hasVisiblePixels) {
        resolve(dataUrl);
        return;
      }

      // Add a small 4px padding around the subject
      const pad = 4;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(img.width, maxX + pad);
      maxY = Math.min(img.height, maxY + pad);

      let cropWidth = maxX - minX;
      let cropHeight = maxY - minY;

      if (cropWidth <= 0 || cropHeight <= 0) {
        resolve(dataUrl);
        return;
      }

      // Scale down only if larger than maxDimension
      let targetWidth = cropWidth;
      let targetHeight = cropHeight;
      if (cropWidth > maxDimension || cropHeight > maxDimension) {
        if (cropWidth > cropHeight) {
          targetHeight = Math.round((cropHeight * maxDimension) / cropWidth);
          targetWidth = maxDimension;
        } else {
          targetWidth = Math.round((cropWidth * maxDimension) / cropHeight);
          targetHeight = maxDimension;
        }
      }

      const destCanvas = document.createElement('canvas');
      destCanvas.width = targetWidth;
      destCanvas.height = targetHeight;
      const destCtx = destCanvas.getContext('2d');
      if (!destCtx) {
        resolve(dataUrl);
        return;
      }

      destCtx.imageSmoothingEnabled = true;
      destCtx.imageSmoothingQuality = 'high';
      destCtx.drawImage(
        srcCanvas,
        minX,
        minY,
        cropWidth,
        cropHeight,
        0,
        0,
        targetWidth,
        targetHeight
      );

      // Transparent WebP first (crisp alpha, high fidelity)
      let finalDataUrl = destCanvas.toDataURL('image/webp', 0.92);

      // If WebP is not supported, use PNG
      if (!finalDataUrl.startsWith('data:image/webp')) {
        finalDataUrl = destCanvas.toDataURL('image/png');
      }

      resolve(finalDataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Resizes an image file or dataUrl to max width/height to avoid browser memory freeze
 */
export async function resizeImageToBlob(
  source: File | Blob | string,
  maxWidth = 800,
  maxHeight = 800
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        if (width / height > maxWidth / maxHeight) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Blob conversion failed'));
        },
        'image/png',
        0.9
      );
    };
    img.onerror = reject;

    if (typeof source === 'string') {
      img.src = source;
    } else {
      img.src = URL.createObjectURL(source);
    }
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * High-performance fallback background remover using corner sampling + chroma/luma flood
 */
async function fallbackSmartRemoveBg(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(img.src);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      // Sample 4 corner colors to detect background color
      const corners = [
        [0, 0],
        [canvas.width - 1, 0],
        [0, canvas.height - 1],
        [canvas.width - 1, canvas.height - 1],
      ];

      let bgR = 0, bgG = 0, bgB = 0;
      for (const [x, y] of corners) {
        const idx = (y * canvas.width + x) * 4;
        bgR += data[idx];
        bgG += data[idx + 1];
        bgB += data[idx + 2];
      }
      bgR /= 4;
      bgG /= 4;
      bgB /= 4;

      const tolerance = 42;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Euclidean color distance from background
        const dist = Math.sqrt(
          Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2)
        );

        if (dist < tolerance) {
          data[i + 3] = 0; // fully transparent
        } else if (dist < tolerance + 20) {
          // Soft edge feathering
          const alphaFactor = (dist - tolerance) / 20;
          data[i + 3] = Math.round(data[i + 3] * alphaFactor);
        }
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}
