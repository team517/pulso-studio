// Geometría de cada formato. Todas las cifras en px del lienzo final.
// Supuesto de la toma (contrato): vertical 1080×1920, cara centrada en y≈640, barbilla en y≈900-950.
// Con el zoom máximo (1,10, origen 50% 30%) la barbilla baja a y≈990: por eso las tarjetas empiezan en ≥1065.

export const SRC = { w: 1080, h: 1920, faceY: 640, chinY: 950 };
export const MAX_ZOOM = 1.1;

// Dónde cae en el lienzo un punto de la toma, dado el marco, el recorte y el zoom
export function mapY(srcY, frame, zoom = 1) {
  const s = Math.max(frame.w / SRC.w, frame.h / SRC.h);
  const oy = (SRC.h * s - frame.h) * frame.py;
  const y = srcY * s - oy;
  const oyz = frame.h * frame.originY;
  return frame.y + oyz + (y - oyz) * zoom;
}

// Recorte vertical (object-position) para que la cara quede a «at» del alto del marco
function cropY(frame, at) {
  const s = Math.max(frame.w / SRC.w, frame.h / SRC.h);
  const extra = SRC.h * s - frame.h;
  if (extra <= 0.5) return 0.5;
  return Math.min(1, Math.max(0, (SRC.faceY * s - frame.h * at) / extra));
}

const ALL = ["card", "checklist", "strike", "stat", "days", "compare", "chart", "behind", "scene", "icons"];

export function layoutGeometry(layout, W, H) {
  if (layout === "horizontal") {
    const fh = H - 80, fw = Math.round(fh * SRC.w / SRC.h);
    const frame = { x: 90, y: 40, w: fw, h: fh, r: 40, originY: 0.3, shadow: true };
    frame.py = cropY(frame, 0.33);
    const px = frame.x + fw + 90, pw = W - px - 90; // panel derecho
    return {
      layout, W, H, frame, bg: true,
      title: { x: px, y: 70, w: pw, h: 230, maxSize: 78, lines: 2, align: "left" },
      slot: { x: px, y: 320, w: pw, h: 440, align: "center", maxScale: 1.35 },
      cap: { x: px, y: 790, w: pw, h: 220, size: 54, key: 104, style: "side" },
      overlayWord: null, // sin mate: la palabra va en el panel (como tarjeta)
      scene: { orient: "row" },
      types: ALL, maxSlot: 99,
    };
  }
  if (layout === "framed") {
    const frame = { x: 90, y: 225, w: 900, h: 920, r: 44, originY: 0.35, shadow: true };
    frame.py = cropY(frame, 0.4);
    const chin = mapY(SRC.chinY, frame, MAX_ZOOM);
    const top = Math.ceil(chin + 30);
    return {
      layout, W, H, frame, bg: true,
      title: { x: 90, y: 50, w: 900, h: 160, maxSize: 64, lines: 2, align: "center" },
      // la tarjeta flota sobre el borde inferior del marco (pecho), los subtítulos van debajo
      slot: { x: 90, y: top, w: 900, h: 1178 - top, align: "end", maxScale: 1 },
      cap: { x: 90, y: 1194, w: 900, h: 120, size: 48, key: 92, style: "below-frame" },
      overlayWord: { x: 110, y: 250, w: 860, h: 170, max: 140 },
      scene: { orient: "col" },
      types: ALL, maxSlot: 99,
    };
  }
  // verticales 1080×1920 a sangre
  const frame = { x: 0, y: 0, w: W, h: H, r: 0, originY: 0.3, py: 0.5, shadow: false };
  const chin = mapY(SRC.chinY, frame, MAX_ZOOM);
  const cardTop = Math.max(1065, Math.ceil(chin + 60));
  const base = {
    layout, W, H, frame, bg: false,
    safe: { top: 220, bottom: 380, right: 140 },
    overlayWord: { x: 70, y: 228, w: 870, h: 210, max: 190 },
    scene: { orient: "col" },
  };
  if (layout === "headline") {
    return {
      ...base,
      title: { x: 70, y: 232, w: 870, h: 250, maxSize: 70, lines: 2, align: "center", band: true },
      slot: { x: 70, y: cardTop, w: 870, h: 1335 - cardTop, align: "start", maxScale: 1 },
      cap: { x: 80, y: 1395, w: 860, h: 145, size: 60, key: 112, style: "bottom" },
      overlayWord: null, // el titular ocupa la parte de arriba: sin mate, la palabra va a la zona de tarjetas
      types: ALL, maxSlot: 4,
    };
  }
  if (layout === "minimal") {
    return {
      ...base, title: null,
      slot: { x: 70, y: cardTop, w: 870, h: 1530 - cardTop, align: "center", maxScale: 1.25 },
      cap: { x: 80, y: 1110, w: 860, h: 420, size: 76, key: 76, style: "karaoke" },
      types: ["stat", "behind"], maxSlot: 99,
    };
  }
  // reference
  return {
    ...base, title: null,
    // como en el reel de referencia: subtítulo pequeño justo bajo la barbilla (y≈1125) y la tarjeta debajo (1215-1540)
    cap: { x: 80, y: cardTop, w: 860, h: 120, size: 56, key: 110, style: "chest" },
    slot: { x: 70, y: cardTop + 150, w: 870, h: 1540 - (cardTop + 150), align: "start", maxScale: 1 },
    types: ALL, maxSlot: 99,
  };
}
