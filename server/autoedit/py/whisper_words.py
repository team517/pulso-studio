"""Transcripción palabra a palabra con Whisper (large-v3-turbo, GPU) → words-raw.json

  python whisper_words.py --audio audio16k.wav --out words-raw.json [--lang es] [--vocab "nombres, marcas"]

Formato de salida (el que espera cut.py): {"text": "...", "words": [{"w","start","end","p"}]}
Se descartan los trozos que Whisper marca como probablemente sin voz (se inventa «Gracias» en el silencio).
"""
import argparse, json
import comun  # consola UTF-8 en Windows
import torch, whisper

ap = argparse.ArgumentParser()
ap.add_argument("--audio", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--lang", default="es")
ap.add_argument("--vocab", default="")
a = ap.parse_args()

dev = "cuda" if torch.cuda.is_available() else "cpu"
model = whisper.load_model("large-v3-turbo", device=dev)
res = model.transcribe(a.audio, language=None if a.lang == "auto" else a.lang, word_timestamps=True,
                       condition_on_previous_text=False, initial_prompt=a.vocab or None, fp16=(dev == "cuda"))
words = []
for seg in res["segments"]:
    if seg.get("no_speech_prob", 0) > 0.5 and seg.get("avg_logprob", 0) < -0.5:
        continue
    if seg.get("avg_logprob", 0) < -1.2:
        continue
    for w in seg.get("words", []):
        t = w["word"].strip()
        if t and w.get("probability", 1) >= 0.15:
            words.append({"w": t, "start": round(w["start"], 3), "end": round(w["end"], 3), "p": round(w.get("probability", 0), 3)})
json.dump({"text": " ".join(w["w"] for w in words), "words": words}, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(words)} palabras · {dev} → {a.out}")
