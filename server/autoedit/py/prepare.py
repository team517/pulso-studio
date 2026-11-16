"""Pasada 0 · Preparar la toma (versión automática de la skill).

  python prepare.py --src toma.mp4 --work trabajo [--res 1080] [--crop 0.5] [--rotate 0|90|180|270]

- Copia la fuente (nunca se toca el original).
- Vertical → 1080×1920. Horizontal → recorta el centro a 9:16 (o --crop 0-1 para mover el recorte).
- Extrae audio16k.wav (Whisper) y audio48k.wav (mezcla).
Escribe info.json con la orientación de origen y la duración.
"""
import argparse, json, os, shutil, subprocess
from comun import venc

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--work", required=True)
ap.add_argument("--res", default="1080", choices=["4k", "1080"])
ap.add_argument("--rotate", default="0", choices=["0", "90", "180", "270"])
ap.add_argument("--crop", type=float, default=0.5)
ap.add_argument("--fps", type=int, default=30)
a = ap.parse_args()

os.makedirs(a.work, exist_ok=True)
src = os.path.join(a.work, "source" + os.path.splitext(a.src)[1].lower())
if not (os.path.exists(src) and os.path.getsize(src) == os.path.getsize(a.src)):
    shutil.copy2(a.src, src)

info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                  "stream=width,height,codec_name,r_frame_rate:stream_side_data=rotation:format=duration",
                                  "-of", "json", src], capture_output=True, text=True, check=True).stdout)
st = info["streams"][0]
w, h = st["width"], st["height"]
rot_meta = next((abs(int(sd.get("rotation", 0))) for sd in st.get("side_data_list", []) if "rotation" in sd), 0)
if rot_meta in (90, 270):
    w, h = h, w
dur = float(info["format"]["duration"])
if a.rotate in ("90", "270"):
    w, h = h, w

vf = {"0": [], "90": ["transpose=1"], "180": ["transpose=1,transpose=1"], "270": ["transpose=2"]}[a.rotate]
orientation = "vertical" if h >= w else "horizontal"
if w > h:
    x = max(0.0, min(1.0, a.crop))
    vf.append(f"crop=ih*9/16:ih:(iw-ih*9/16)*{x:.3f}:0")
W, H = (2160, 3840) if a.res == "4k" else (1080, 1920)
vf += [f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos", f"crop={W}:{H}", f"fps={a.fps}", "setsar=1"]

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", ",".join(vf), *venc("hq", "auto", W, H, a.fps), "-pix_fmt", "yuv420p", "-an",
                os.path.join(a.work, "vertical.mp4")], check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", os.path.join(a.work, "audio16k.wav")], check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-c:a", "pcm_s24le", "-ar", "48000", os.path.join(a.work, "audio48k.wav")], check=True)
json.dump({"srcWidth": w, "srcHeight": h, "orientation": orientation, "duration": round(dur, 3), "width": W, "height": H, "fps": a.fps},
          open(os.path.join(a.work, "info.json"), "w", encoding="utf-8"))
print(f"listo · fuente {w}×{h} ({orientation}) · {dur:.1f} s → {W}×{H}")
