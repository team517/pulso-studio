# Auto-edición · contrato entre piezas

Pulso Studio genera, de un vídeo hablado, **5 versiones editadas** (y shorts de vídeos largos). Método: el de la skill
`editar-reels-claude` (`~/.claude/skills/editar-reels-claude/docs/PIPELINE-edicion-reels-IA.md`), automatizado.

```
pipeline.js (orquesta, servidor)
  1. prepare     → work/master.mp4 (1080×1920 o el formato de origen, 30 fps) + audio16k.wav + audio48k.wav
  2. transcribe  → work/words-raw.json            (Whisper large-v3-turbo, GPU, de uno en uno)
  3. cut         → work/cut.mp4 + work/words.json  (pausas >0,4 s, tomas repetidas; tramos que deja Claude)
  4. matte       → work/matte.mp4 (gris, RVM)      (solo si alguna versión usa "behind")
  5. plan        → work/plan.json                  (Claude: frases+palabras clave, gráficos, zooms, gancho… por versión)
  6. por versión (una detrás de otra, y se entrega cada una en cuanto acaba):
       render/renderVariant(input)  → vídeo sin audio + eventos de efectos
       audio (mix)                  → voz limpia + efectos + música con ducking + máster −14 LUFS
       registro en `exports` + `autoedit_variants` (aparece en la pantalla de revisión)
```

## `renderVariant(input, onProgress) → Promise<RenderOutput>`  (módulo `server/autoedit/render/index.js`)

```ts
type RenderInput = {
  workDir: string;                 // carpeta propia de esta versión (se crea si no existe); el proyecto HyperFrames va dentro
  layout: "reference" | "headline" | "minimal" | "horizontal" | "framed";
  width: number; height: number;   // 1080×1920 (reference/headline/minimal), 1920×1080 (horizontal), 1080×1350 (framed)
  fps: 30;
  duration: number;                // segundos (= duración de cut.mp4)
  base: { video: string; matte: string | null; srcWidth: number; srcHeight: number }; // rutas absolutas; base es 1080×1920 vertical
  words: { w: string; s: number; e: number }[];     // reloj de todo, ya en la línea de tiempo cortada
  captions: {                      // trozos de 1-3 palabras; uno de cada frase es la palabra clave
    start: number; end: number; key: boolean; phrase: number;
    words: { w: string; t: number }[];              // t = cuándo aparece cada palabra
  }[];
  hook: { title: string; subtitle?: string } | null;  // titular (headline, framed, horizontal); null en el resto
  graphics: Graphic[];             // ordenados por start; nunca dos a la vez en el mismo sitio
  zooms: { t: number; to: number; dur: number; ease?: string }[];   // máx 1.10, nunca cortes
  captionStyle: "chest" | "bottom" | "karaoke" | "side" | "below-frame";
  theme: { accent: string; accent2: string; gold: string; bg: string; red: string }; // HEX
  hideCaptionsDuring?: [number, number][];          // tramos sin subtítulos (escena completa, palabra detrás…)
};

type Graphic =
  | { type: "card";      start: number; end: number; icon: Icon; title: string; subtitle?: string }
  | { type: "checklist"; start: number; end: number; title?: string; items: { text: string; t: number }[] }
  | { type: "strike";    start: number; end: number; items: { text: string; t: number }[]; final?: string } // tacha y deja `final`
  | { type: "stat";      start: number; end: number; value: number; prefix?: string; suffix?: string; label: string }  // anillo de luz + número que sube
  | { type: "days";      start: number; end: number; days: string[]; label?: string }   // ["L","M","X","J","V"] con checks
  | { type: "compare";   start: number; end: number; left: { icon: Icon; label: string }; right: { icon: Icon; label: string; bad?: boolean } }
  | { type: "chart";     start: number; end: number; title: string; points: number[] } // línea que sube
  | { type: "behind";    start: number; end: number; text: string }                    // palabra gigante detrás de la cabeza (necesita matte)
  | { type: "scene";     start: number; end: number; kicker?: string; title: string; steps: { icon: Icon; label: string; t: number }[] } // pantalla completa
  | { type: "icons";     start: number; end: number; items: { icon: Icon; label?: string; t: number }[] }; // fila de iconos que entran en su palabra

type Icon = "check" | "x" | "mail" | "calendar" | "chart" | "gear" | "user" | "users" | "money" | "rocket" | "clock" | "target"
  | "bolt" | "phone" | "star" | "video" | "chat" | "lock" | "heart" | "search" | "doc" | "megaphone" | "trophy" | "camera" | "link" | "warning";

type RenderOutput = {
  video: string;                   // MP4 H.264 sin audio (o con el audio de base, da igual: el mezclador pone el definitivo)
  sfx: { t: number; kind: "hit" | "whoosh" | "pop" | "click" | "riser" | "sparkle" | "typing" }[]; // 20-40 ms antes de cada visual
};
```

### Reglas de diseño (de la skill, a 1080×1920 = mitad de las cifras 4K)
- Zona segura Instagram: 220 px arriba, 380 abajo, 140 a la derecha.
- Barbilla en y≈900-950: **tarjetas desde top ≥ 1065 px**, también con el zoom máximo; subtítulos `chest` en top 1260, alto 260.
- Cristal líquido: `backdrop-filter: blur(23px) saturate(1.45)`, borde 1.5 px, radio 32 px, filo de luz arriba, barrido de luz.
- Tarjetas con rebote VB(0.07) 1.1 s; **textos sin rebote** (entradas suaves 0,3-0,45 s, por caracteres/palabras/línea).
- Palabra clave: Anton, oro, grande; resto: fuente de subtítulo media. Fuentes locales con `@font-face`.
- Una idea en pantalla cada vez; oculta subtítulos cuando el gráfico ya lo dice.
- Selectores literales en el JS generado (nada de `` `#${id}` `` dentro de las composiciones).
