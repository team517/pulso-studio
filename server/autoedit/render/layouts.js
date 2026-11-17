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

const ALL = ["card", "checklist", "strike", "stat", "days", "compare", "chart", "behind", "scene", "icons", "custom", "motion", "logo", "image"];

// maxZoom: tope de zoom del estilo (motion.zoomMax); con más zoom la barbilla baja y las tarjetas empiezan más abajo
export function layoutGeometry(layout, W, H, maxZoom = MAX_ZOOM) {
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
    const chin = mapY(SRC.chinY, frame, maxZoom);
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
  const chin = mapY(SRC.chinY, frame, maxZoom);
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

// ─────────────── estilo del usuario: posición de subtítulos y logo ───────────────
// pos: "auto" | "high" | "low"; logo: { position, size (fracción del ancho), aspect (alto/ancho) } | null
// v2 (opcional): { yPct: centro vertical de los subtítulos (fracción del alto) | null, letterbox: franjas de cine }
export function applyStyleGeometry(geo, pos, logo, v2 = null) {
  const g = JSON.parse(JSON.stringify(geo));
  const vertical = g.H > g.W && g.frame.r === 0;
  // franjas negras de cine (solo verticales a sangre): ~6 % arriba y abajo; nada se sale de la zona visible
  if (v2?.letterbox && vertical) g.letterbox = Math.round(g.H * 0.06);
  if (v2?.yPct != null) placeCaptionAt(g, v2.yPct);
  else if (pos === "high" || pos === "low") {
    const top = g.layout === "reference" ? g.cap.y : g.slot.y; // primera línea libre bajo la barbilla
    if (g.layout === "reference" && pos === "low") {
      // como la caja «chest» del contrato: tarjetas pegadas a la barbilla y subtítulos debajo
      g.slot = { ...g.slot, y: top, h: 1370 - top };
      g.cap = { ...g.cap, y: 1395, h: 145 };
    } else if (g.layout === "headline" && pos === "high") {
      g.cap = { ...g.cap, y: top, h: 120 };
      g.slot = { ...g.slot, y: top + 150, h: 1540 - (top + 150) };
    } else if (g.layout === "minimal") {
      g.cap = pos === "high" ? { ...g.cap, y: 1065, h: 300 } : { ...g.cap, y: 1240, h: 300 };
    } else if (g.layout === "horizontal" && pos === "high") {
      g.cap = { ...g.cap, y: 320, h: 190 };
      g.slot = { ...g.slot, y: 530, h: 480 };
    }
    // framed: los subtítulos ya van fuera del marco; «high»/«low» se quedan como «auto»
  }
  if (g.letterbox) {
    const lb = g.letterbox + 8;
    for (const k of ["title", "slot", "cap", "overlayWord"]) {
      const r = g[k];
      if (!r) continue;
      const y = Math.max(r.y, lb), y1 = Math.min(r.y + r.h, g.H - lb);
      if (y !== r.y || y1 !== r.y + r.h) g[k] = { ...r, y, h: Math.max(40, y1 - y) };
    }
  }
  if (logo) {
    const W = g.W, H = g.H;
    let w = Math.round(logo.size * W), h = Math.round(w * logo.aspect);
    // zona permitida y caja de la cara que nunca se tapa
    let area, face;
    if (vertical) { area = { x0: 60, y0: Math.max(230, (g.letterbox || 0) + 20), x1: W - 140, y1: Math.min(H - 380, H - (g.letterbox || 0) - 20) }; face = { x0: 290, y0: 230, x1: 790, y1: 1000 }; }
    else if (g.layout === "horizontal") { area = { x0: 30, y0: 30, x1: W - 30, y1: H - 30 }; const f = g.frame; face = { x0: f.x + f.w * 0.2, y0: f.y, x1: f.x + f.w * 0.8, y1: f.y + f.h * 0.62 }; }
    else { area = { x0: 24, y0: 24, x1: W - 24, y1: H - 24 }; const f = g.frame; face = { x0: f.x + f.w * 0.22, y0: f.y, x1: f.x + f.w * 0.78, y1: f.y + f.h * 0.72 }; }
    const left = logo.position.endsWith("left"), topPos = logo.position.startsWith("top");
    const place = () => ({ x: left ? area.x0 : area.x1 - w, y: topPos ? area.y0 : area.y1 - h, w, h });
    const hits = (b, r) => b.x < r.x1 && b.x + b.w > r.x0 && b.y < r.y1 && b.y + b.h > r.y0;
    let box = place();
    // más pequeño hasta que no toque la cara (mínimo 6 % del ancho)
    while (hits(box, face) && w > W * 0.06) { w = Math.round(w * 0.9); h = Math.round(w * logo.aspect); box = place(); }
    if (hits(box, face)) { // aún toca (logo muy alto): se baja/sube fuera de la cara
      box.y = topPos ? Math.min(area.y1 - h, face.y1 + 20) : box.y;
    }
    g.logo = box;
    // lo que comparte franja con el logo se estrecha por los dos lados (sigue centrado)
    const gap = 18;
    for (const k of ["title", "slot", "cap"]) {
      const r = g[k];
      if (!r) continue;
      const overlapY = r.y < box.y + box.h && r.y + r.h > box.y;
      const overlapX = r.x < box.x + box.w && r.x + r.w > box.x;
      if (!overlapY || !overlapX) continue;
      const need = left ? box.x + box.w + gap - r.x : r.x + r.w - (box.x - gap);
      if (need > 0 && r.w - 2 * need > 300) g[k] = { ...r, x: r.x + need, w: r.w - 2 * need };
    }
  }
  return g;
}

// Subtítulos con el centro a «yPct» del alto (calcado de una referencia). La caja conserva su ancho (zona segura)
// y no se sale del cuadro (ni de las franjas de cine). Las tarjetas pasan al hueco libre más grande de su zona
// (si mide ≥ 240 px); si no hay hueco, se quedan donde estaban y los subtítulos se ocultan mientras se ven.
function placeCaptionAt(g, yPct) {
  const c = g.cap, lb = g.letterbox || 0;
  const lo = lb + 12, hi = g.H - lb - 12;
  const y = Math.round(Math.max(lo, Math.min(hi - c.h, yPct * g.H - c.h / 2)));
  const gap = 20, s = g.slot;
  g.cap = { ...c, y };
  if (!s || g.layout === "minimal") return; // minimal oculta los subtítulos mientras hay un gráfico
  // zona de tarjetas: en «reference» empezaba bajo el subtítulo (que ya no está ahí); en el resto, la de siempre
  const zTop = g.layout === "reference" ? Math.min(c.y, s.y) : s.y, zBot = s.y + s.h;
  const pieces = [[zTop, Math.min(zBot, y - gap)], [Math.max(zTop, y + c.h + gap), zBot]];
  const [a, b] = pieces.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
  if (b - a >= 240) g.slot = { ...s, y: a, h: b - a };
  else if (s.y < y + c.h && s.y + s.h > y) g.hideCapsOnSlot = true; // no cabe al lado: mientras hay tarjeta, sin subtítulos
}
