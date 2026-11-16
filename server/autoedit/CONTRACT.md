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

## Estilo de edición del usuario (`RenderInput.style`, opcional)

El usuario define su estilo en la pantalla «Estilo de edición» (fuentes, colores, tarjetas, animación, logo, referencias).
Si `style` viene, manda sobre los valores por defecto del diseño (y sobre `theme` en los colores que traiga).

```ts
type FontRef = { family: string; file: string /* ruta absoluta .ttf/.otf/.woff/.woff2 */; weight?: number };
type UserStyle = {
  fonts?: { caption?: FontRef; keyword?: FontRef; title?: FontRef };      // subtítulos · palabra clave · titulares y tarjetas
  colors?: { accent?: string; accent2?: string; keyword?: string; caption?: string; bg?: string }; // HEX
  caption?: {
    size?: "s" | "m" | "l";                                // tamaño de los subtítulos
    uppercase?: boolean;                                   // todo en mayúsculas
    position?: "auto" | "high" | "low";                    // auto = la del layout; high = más cerca de la barbilla; low = más abajo (dentro de la zona segura)
    animation?: "soft" | "pop" | "typewriter" | "word";    // soft = la actual; pop = escala con rebote suave; typewriter = letra a letra; word = palabra a palabra
    keywordStyle?: "big" | "highlight" | "box";            // big = Anton grande (actual); highlight = mismo tamaño en color; box = caja de color detrás
  };
  cards?: { look?: "glass" | "solid" | "light" };          // glass = cristal (actual); solid = color sólido oscuro; light = tarjeta blanca con sombra (como la escena blanca de la referencia)
  motion?: { intensity?: 1 | 2 | 3 };                      // 1 = sobrio (menos rebote y zoom), 2 = actual, 3 = enérgico (más rebote, zooms más marcados, más movimiento)
  logo?: { file: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; size: number /* 0.06-0.2 del ancho */ } | null;
};
```
Reglas: con fuentes del usuario, se cargan con `@font-face` desde una copia dentro del proyecto HyperFrames (nada de rutas fuera);
el ajuste automático de tamaños tiene que seguir funcionando con la fuente del usuario (medir con un margen mayor si no se puede medir);
el logo nunca tapa la cara ni la zona segura; los colores tienen que tener contraste suficiente (si no, se oscurece/aclara el fondo de la tarjeta).

## UserStyle v2 · calcar una referencia (todo opcional)

Para copiar al detalle («calcado») un reel de referencia: tipografía, color, tamaño, posición, borde/sombra de los
subtítulos, palabras por trozo, palabra clave, estilo de zoom y aspecto de cine, con pocos o ningún gráfico.
**Cada campo es opcional; si no viene, todo queda exactamente como antes** (mismo HTML/JS generado, byte a byte).
Valores fuera de rango se recortan; HEX inválidos se ignoran.

```ts
type UserStyle = {
  // …campos de arriba…
  caption?: {
    // los de siempre: size, uppercase, position, animation, keywordStyle
    scale?: number;          // 0.6–1.6; si viene, manda sobre `size` (factor sobre el tamaño del formato)
    yPct?: number;           // centro vertical de la caja de subtítulos, fracción del alto (p. ej. 0.72); manda sobre `position`.
                             // Se recorta a 0.12–0.86; la caja mantiene su ancho (zona segura) y no se sale del cuadro ni de las franjas.
                             // Vale para chest/bottom/side/below-frame y karaoke. Las tarjetas pasan al hueco libre más grande
                             // (≥ 240 px) de su zona; si no hay hueco, se quedan y los subtítulos se ocultan mientras se ven.
    weight?: number;         // 100–900 (se redondea a centenas): peso de la fuente de subtítulos (el ajuste mide más ancho si > 700)
    stroke?: { color: string; width: number } | null;   // borde del texto: HEX + px visibles fuera de la letra a 1080 px de lado corto
                             // (0.5–16; se escala con el lado corto del lienzo). Se pinta con -webkit-text-stroke + paint-order: stroke fill (el relleno queda encima)
    shadow?: "none" | "soft" | "strong";                // sustituye la sombra por defecto (también la de la palabra clave).
                             // Texto oscuro → sombras claras. «none» sin borde ni caja deja una sombra mínima (0 1px 3px) para que se lea.
    bg?: { color: string; opacity: number; radius: number } | null; // caja detrás de cada subtítulo (estilo TikTok):
                             // HEX, opacidad 0.05–1, radio 0–60 px a 1080 de lado corto; relleno .25em .45em (el ajuste de tamaño lo descuenta)
    letterSpacing?: number;  // em, −0.1–0.3 (p. ej. −0.02 o 0.02); se aplica también a la palabra clave
    lines?: 1 | 2;           // máximo de líneas por trozo: 1 = siempre una línea (se reduce el tamaño lo que haga falta); 2 = como antes
    keywordColor?: string;   // HEX de la palabra clave en los subtítulos (big: texto; highlight: texto; box: color de la caja;
                             // karaoke: palabra clave). Sin él, theme.gold como siempre
    keywordScale?: number;   // 0.6–2. highlight: tamaño de la palabra clave respecto al del subtítulo; big: respecto al tamaño
                             // de palabra clave del formato. Por defecto 1
    keywordFont?: "same" | "keyword";  // same = la palabra clave usa la fuente (y el peso) de los subtítulos; keyword = fuente de
                             // palabra clave también en highlight/box. Sin él: big → fuente de palabra clave, highlight/box → la de subtítulos
  };
  motion?: {
    intensity?: 1 | 2 | 3;   // el de siempre
    zoomStyle?: "smooth" | "punch" | "none";  // smooth = zooms suaves (actual); punch = en cada zoom la escala salta al instante
                             // (duración 0, sin curva, sin zoom de entrada; típico de reels con cortes); none = ningún zoom (tampoco el de entrada)
    zoomMax?: number;        // 1.0–1.25: tope de escala del zoom (sustituye a MAX_ZOOM = 1.10). Con más zoom las tarjetas empiezan
                             // más abajo para no tapar la barbilla
  };
  look?: {                   // aspecto de cine (no confundir con cards.look)
    grain?: number;          // 0–1: grano de película (tesela de ruido SVG en «overlay» que salta 12 veces/s, movida por la línea
                             // de tiempo de GSAP con steps(): determinista al buscar fotograma). Encima de la toma, debajo de gráficos y subtítulos
    vignette?: number;       // 0–1: viñeta radial sobre la toma (fuera de #zoom: no escala con el zoom)
    letterbox?: boolean;     // franjas negras arriba y abajo (6 % del alto cada una) en los verticales a sangre (reference, headline,
                             // minimal); subtítulos, titular, tarjetas, palabra gigante y logo se mantienen dentro de la zona visible
  };
};
```

En `RenderInput.zooms[]`, un zoom con `ease: "cut"` es un cambio de escala instantáneo (duración 0), en cualquier `zoomStyle`
salvo `none`.
