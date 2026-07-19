// Détourage automatique du fond d'une photo produit (fond blanc / uni des
// sites marchands) : remplissage par diffusion depuis les bords de l'image.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function colorDist(r: number, g: number, b: number, ref: Rgb): number {
  return Math.sqrt((r - ref.r) ** 2 + (g - ref.g) ** 2 + (b - ref.b) ** 2);
}

/** Couleur moyenne des pixels du pourtour de l'image (le fond, sur une photo produit). */
function borderColor(data: Uint8ClampedArray, w: number, h: number): Rgb {
  let r = 0, g = 0, b = 0, n = 0;
  const acc = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  };
  for (let x = 0; x < w; x++) {
    acc(x, 0);
    acc(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    acc(0, y);
    acc(w - 1, y);
  }
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Supprime le fond d'une image (dataURL) par diffusion depuis les bords :
 * tous les pixels contigus au pourtour et proches de la couleur de fond
 * deviennent transparents, avec un léger adoucissement du contour.
 *
 * Rejette avec une erreur si le fond ne semble pas détourable (fond non uni :
 * presque rien ou presque tout serait supprimé).
 */
export function removeBackground(dataUrl: string, tolerance = 30): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Image illisible'));
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w === 0 || h === 0) {
        reject(new Error('Image vide'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Contexte canvas indisponible'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const bg = borderColor(data, w, h);

      // Diffusion (BFS 4-connexe) depuis les bords : file d'indices de pixels.
      const removed = new Uint8Array(w * h);
      const queue: number[] = [];
      const tryPush = (x: number, y: number, tol: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const p = y * w + x;
        if (removed[p]) return;
        const i = p * 4;
        if (colorDist(data[i], data[i + 1], data[i + 2], bg) <= tol) {
          removed[p] = 1;
          queue.push(p);
        }
      };
      for (let x = 0; x < w; x++) {
        tryPush(x, 0, tolerance);
        tryPush(x, h - 1, tolerance);
      }
      for (let y = 0; y < h; y++) {
        tryPush(0, y, tolerance);
        tryPush(w - 1, y, tolerance);
      }
      // Tolérance légèrement élargie à l'intérieur pour absorber les ombres portées douces.
      const innerTol = tolerance * 1.25;
      let head = 0;
      while (head < queue.length) {
        const p = queue[head++];
        const x = p % w;
        const y = (p - x) / w;
        tryPush(x + 1, y, innerTol);
        tryPush(x - 1, y, innerTol);
        tryPush(x, y + 1, innerTol);
        tryPush(x, y - 1, innerTol);
      }

      const removedCount = queue.length;
      const ratio = removedCount / (w * h);
      if (ratio < 0.03 || ratio > 0.97) {
        reject(new Error("Le fond ne semble pas uni : détourage automatique impossible sur cette image."));
        return;
      }

      for (let p = 0; p < removed.length; p++) {
        if (removed[p]) data[p * 4 + 3] = 0;
      }
      // Adoucissement : les pixels conservés en lisière du fond deviennent semi-transparents.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (removed[p]) continue;
          const nearRemoved =
            (x > 0 && removed[p - 1]) ||
            (x < w - 1 && removed[p + 1]) ||
            (y > 0 && removed[p - w]) ||
            (y < h - 1 && removed[p + w]);
          if (nearRemoved) data[p * 4 + 3] = Math.round(data[p * 4 + 3] * 0.55);
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}
