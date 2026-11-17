"""Igualar el color de una toma al de un vídeo de referencia: crea una LUT 3D (.cube) para ffmpeg (lut3d).

Método: transferencia de color de Reinhard en espacio Lab (media y desviación de cada canal), medida sobre
fotogramas repartidos de los dos vídeos, con límites para que nunca quede exagerado y una mezcla final.

  python color_match.py --src toma.mp4 --ref referencia.mp4 [--ref otra.mp4] --out color.cube [--strength 0.85]
"""
import argparse, json, subprocess, sys
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--ref", action="append", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--strength", type=float, default=0.8)
ap.add_argument("--size", type=int, default=33)
a = ap.parse_args()

W = 192

def duration(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except ValueError: return 0.0

def frames(f, n=14):
    """Fotogramas repartidos (RGB 0-1), sin los bordes negros."""
    d = duration(f) or 10
    out = []
    for i in range(n):
        t = d * (0.05 + 0.9 * i / max(1, n - 1))
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", f, "-frames:v", "1", "-vf", f"scale={W}:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True)
        if not r.stdout: continue
        px = np.frombuffer(r.stdout, np.uint8)
        h = len(px) // (W * 3)
        if h < 4: continue
        img = px[: h * W * 3].reshape(h, W, 3).astype(np.float32) / 255.0
        out.append(img.reshape(-1, 3))
    if not out:
        sys.exit(f"no he podido leer {f}")
    allpx = np.concatenate(out)
    lum = allpx.mean(1)
    return allpx[(lum > 0.02) & (lum < 0.98)]  # fuera negros y blancos puros (bandas, texto quemado)

# sRGB <-> Lab (D65)
M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
Minv = np.linalg.inv(M)
WP = np.array([0.95047, 1.0, 1.08883])

def to_lab(rgb):
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = lin @ M.T / WP
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)

def from_lab(lab):
    fy = (lab[:, 0] + 16) / 116
    fx = fy + lab[:, 1] / 500
    fz = fy - lab[:, 2] / 200
    f = np.stack([fx, fy, fz], 1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * WP
    lin = np.clip(xyz @ Minv.T, 0, 1)
    return np.clip(np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055), 0, 1)

src = to_lab(frames(a.src))
ref = to_lab(np.concatenate([frames(r) for r in a.ref]))
ms, ss = src.mean(0), src.std(0) + 1e-6
mr, sr = ref.mean(0), ref.std(0) + 1e-6
ratio = np.clip(sr / ss, [0.75, 0.78, 0.78], [1.3, 1.5, 1.5])  # nunca exagerado (la piel no se queda gris)
shift = mr - ms
shift[0] = np.clip(shift[0], -12, 12)                           # brillo: como mucho ±12 L
shift[1:] = np.clip(shift[1:], -9, 9)                            # tono: como mucho ±9 (cambia el ambiente, no la piel)

N = a.size
g = np.linspace(0, 1, N)
b_, g_, r_ = np.meshgrid(g, g, g, indexing="ij")                 # .cube: el rojo cambia más rápido
grid = np.stack([r_.ravel(), g_.ravel(), b_.ravel()], 1)
lab = to_lab(grid)
moved = (lab - ms) * ratio + ms + shift
skin = ((lab[:, 1] > 6) & (lab[:, 2] > 8) & (lab[:, 0] > 25) & (lab[:, 0] < 85))[:, None]
moved = np.where(skin, lab + (moved - lab) * np.array([0.9, 0.45, 0.45]), moved)
outrgb = from_lab(moved)
outrgb = grid + (outrgb - grid) * a.strength

with open(a.out, "w") as f:
    f.write(f'TITLE "Pulso Studio: color de la referencia"\nLUT_3D_SIZE {N}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
    for p in outrgb:
        f.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")

print(json.dumps({"src_mean": ms.round(2).tolist(), "ref_mean": mr.round(2).tolist(), "ratio": ratio.round(3).tolist(), "shift": shift.round(2).tolist(), "lut": a.out}))
