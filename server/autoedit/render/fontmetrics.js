// Mide una fuente del usuario leyendo sus tablas (cmap + hmtx): anchos reales por carácter, en «em».
// Soporta .ttf/.otf y .woff (zlib). Para .woff2 u otros casos devuelve null (se estima con más margen).
import fs from "node:fs";
import zlib from "node:zlib";

function sfntFromWoff(buf) {
  const numTables = buf.readUInt16BE(12);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = buf.toString("latin1", o, o + 4);
    const off = buf.readUInt32BE(o + 4), comp = buf.readUInt32BE(o + 8), orig = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(off, off + comp);
    tables[tag] = comp < orig ? zlib.inflateSync(raw) : raw;
  }
  return tables;
}

function sfntTables(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString("latin1", o, o + 4);
    const off = buf.readUInt32BE(o + 8), len = buf.readUInt32BE(o + 12);
    tables[tag] = buf.subarray(off, off + len);
  }
  return tables;
}

// cmap: código → glifo (formatos 4 y 12, Unicode)
function readCmap(t) {
  const n = t.readUInt16BE(2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const pid = t.readUInt16BE(4 + i * 8), eid = t.readUInt16BE(6 + i * 8), off = t.readUInt32BE(8 + i * 8);
    const fmt = t.readUInt16BE(off);
    const score = (pid === 3 && eid === 10 && fmt === 12) ? 3 : (pid === 0 && fmt === 12) ? 3 : (pid === 3 && eid === 1 && fmt === 4) ? 2 : (pid === 0 && fmt === 4) ? 1 : 0;
    if (score && (!best || score > best.score)) best = { off, fmt, score };
  }
  if (!best) return null;
  const map = new Map(), o = best.off;
  if (best.fmt === 4) {
    const segX2 = t.readUInt16BE(o + 6), seg = segX2 / 2;
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < seg; s++) {
      const end = t.readUInt16BE(ends + s * 2), start = t.readUInt16BE(starts + s * 2);
      const delta = t.readInt16BE(deltas + s * 2), ro = t.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        if (c > 0x24ff) break; // basta con latín y signos
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = ranges + s * 2 + ro + (c - start) * 2;
          g = t.readUInt16BE(gi);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else {
    const groups = t.readUInt32BE(o + 12);
    for (let i = 0; i < groups; i++) {
      const b = o + 16 + i * 12, s = t.readUInt32BE(b), e = Math.min(t.readUInt32BE(b + 4), 0x24ff), g0 = t.readUInt32BE(b + 8);
      for (let c = s; c <= e; c++) map.set(c, g0 + (c - s));
    }
  }
  return map;
}

export function measureFont(file) {
  try {
    const buf = fs.readFileSync(file);
    const sig = buf.toString("latin1", 0, 4);
    let T;
    if (sig === "wOFF") T = sfntFromWoff(buf);
    else if (sig === "\x00\x01\x00\x00" || sig === "OTTO" || sig === "true") T = sfntTables(buf);
    else return null; // woff2, ttc…: sin medir
    if (!T.head || !T.hhea || !T.hmtx || !T.cmap) return null;
    const upm = T.head.readUInt16BE(18);
    const nH = T.hhea.readUInt16BE(34);
    const adv = (g) => T.hmtx.readUInt16BE(4 * Math.min(g, nH - 1));
    const cmap = readCmap(T.cmap);
    if (!cmap || !upm) return null;
    const widths = new Map();
    for (const [c, g] of cmap) widths.set(c, adv(g) / upm);
    const sample = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((ch) => widths.get(ch.codePointAt(0))).filter(Boolean);
    const avg = sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : 0.6;
    return { widths, avg, upm };
  } catch {
    return null;
  }
}
