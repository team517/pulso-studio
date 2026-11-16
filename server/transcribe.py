"""Transcribe un archivo con Whisper (GPU si hay) y saca las palabras con sus tiempos.

Uso: python transcribe.py <archivo> [idioma]
Salida (última línea de stdout): JSON [{"w": "hola", "s": 0.12, "e": 0.40}, ...]
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import torch  # noqa: E402
import whisper  # noqa: E402


def main() -> None:
    path = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "auto" else None
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = whisper.load_model("large-v3-turbo", device=device)
    result = model.transcribe(
        path,
        language=lang,
        word_timestamps=True,
        fp16=(device == "cuda"),
        condition_on_previous_text=False,
        verbose=None,
    )
    words = []
    for seg in result.get("segments", []):
        # Whisper a veces "oye" frases en el silencio o la música ("Gracias", "Suscríbete"…):
        # se descartan los trozos que él mismo marca como probablemente sin voz.
        if seg.get("no_speech_prob", 0) > 0.5 and seg.get("avg_logprob", 0) < -0.5:
            continue
        if seg.get("avg_logprob", 0) < -1.2:
            continue
        for w in seg.get("words", []):
            if w.get("probability", 1) < 0.15:
                continue
            text = w.get("word", "").strip()
            if text:
                words.append({"w": text, "s": round(float(w["start"]), 3), "e": round(float(w["end"]), 3)})
    sys.stdout.write("\n" + json.dumps(words, ensure_ascii=True) + "\n")


if __name__ == "__main__":
    main()
