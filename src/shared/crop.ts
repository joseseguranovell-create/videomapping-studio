/** Encuadre de la foto de referencia: qué zona de la foto cubre el fotograma del proyector. */
export interface Crop { x: number; y: number; w: number; h: number }

/** Posición en % de la foto dentro de un contenedor del tamaño del fotograma, para mostrar solo la zona `crop`. */
export function cropStyle(crop: Crop | null): { left: string; top: string; width: string; height: string } {
  if (!crop) return { left: '0%', top: '0%', width: '100%', height: '100%' };
  return { left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%`, width: `${100 / crop.w}%`, height: `${100 / crop.h}%` };
}

/** Rectángulo de origen en píxeles de la foto para dibujarla en el fotograma con `drawImage`. */
export function cropSource(crop: Crop | null, imgW: number, imgH: number): [number, number, number, number] {
  if (!crop) return [0, 0, imgW, imgH];
  return [crop.x * imgW, crop.y * imgH, crop.w * imgW, crop.h * imgH];
}

/**
 * Encuadre más grande con la proporción de la salida (ancho/alto) que cabe en la foto, centrado en (cx, cy)
 * y reducido por `zoom` (1 = el mayor posible). Siempre queda dentro de la foto.
 */
export function fitCrop(photoW: number, photoH: number, outAspect: number, cx = 0.5, cy = 0.5, zoom = 1): Crop {
  const photoAspect = photoW / photoH;
  let w: number, h: number;
  if (photoAspect >= outAspect) { h = 1; w = outAspect / photoAspect; } else { w = 1; h = photoAspect / outAspect; }
  w *= Math.min(1, zoom); h *= Math.min(1, zoom);
  const x = Math.min(1 - w, Math.max(0, cx - w / 2));
  const y = Math.min(1 - h, Math.max(0, cy - h / 2));
  return { x, y, w, h };
}
