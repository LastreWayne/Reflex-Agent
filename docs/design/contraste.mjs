/*
 * Calculadora de contraste WCAG 2.1 para la paleta de globals.css.
 * Uso: node docs/design/contraste.mjs
 *
 * Modo claro únicamente: el proyecto dejó de tener modo oscuro.
 *
 * Además de los pares planos, compone el PEOR CASO del texto sobre vidrio:
 * la línea de flujo más oscura, cruzada consigo misma, vista a través del
 * panel. `backdrop-filter: blur()` sólo promedia, así que el píxel real nunca
 * es más oscuro que este cálculo — es una cota, no un promedio.
 *
 * No es parte del build ni del bundle: es la herramienta de verificación.
 */

const aRgb = (h) => {
  const s = h.replace("#", "")
  const n = s.length === 3 ? s.split("").map((c) => c + c).join("") : s
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16))
}

const aHex = (rgb) =>
  "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

const lum = (h) => {
  const [r, g, b] = aRgb(h).map((c) => lin(c / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** `frente` con opacidad `alfa` encima de `fondo`. Composición simple. */
const sobre = (frente, alfa, fondo) => {
  const f = aRgb(frente)
  const d = aRgb(fondo)
  return aHex(f.map((c, i) => c * alfa + d[i] * (1 - alfa)))
}

const T = {
  papel: "#f2efe7",
  "papel-alto": "#faf8f2",
  "papel-hondo": "#e7e3d8",
  tinta: "#17140f",
  "tinta-media": "#57513f",
  "tinta-tenue": "#6b6450",
  linea: "#ddd8c9",
  "linea-fuerte": "#bdb6a2",
  "linea-control": "#867f6b",
  amarillo: "#f2c200",
  "amarillo-alto": "#ffd21e",
  "punto-aro": "#8a6b00",
  oro: "#6a5000",
  "amarillo-palido": "#fbf0c9",
  "sobre-amarillo": "#1a1610",
  vidrio: "#faf8f2",
  foco: "#6a5000",
}

/* ── El peor caso del fondo de flujo ───────────────────────────────────
   Trazo más opaco del campo: strokeOpacity 0.70 (índice 23) por el pico del
   latido del <svg> (0.78) = 0.546. Donde dos líneas se cruzan la cobertura
   compone: 1 − (1 − 0.546)² = 0.794. El trazo es --tinta-media, no --tinta:
   un dibujo callado deja subir la densidad sin comerse el texto de arriba. */
const COBERTURA_PEOR = 0.83

/* ── Los alfa del vidrio, 27/07 · segunda vuelta ───────────────────────
   El humano pidió el marco MUCHO más transparente. Bajó de 0.68 a 0.30, y
   a 0.30 `--tinta-media` da 2.67:1 sobre el peor momento del campo: no
   pasa. La salida no fue subir el vidrio entero —eso sería deshacer el
   pedido— sino poner densidad sólo bajo las letras: `--lavado-hero`, un
   rectángulo de papel con halo anclado al bloque de texto (globals.css § 6).

   El vidrio vive en el canto; el lavado vive bajo el texto. Las dos capas
   componen: α = a₁ + a₂·(1 − a₁). */
const ALFA_HERO = 0.3
const ALFA_LAVADO = 0.56
const ALFA_PESTANA = 0.88
const ALFA_PESTANA_ABIERTA = 0.95
const ALFA_HERO_SIN_SOPORTE = 0.94

/** Dos capas del mismo papel, una sobre la otra. */
const componer = (a1, a2) => a1 + a2 * (1 - a1)
const ALFA_HERO_LAVADO = componer(ALFA_HERO, ALFA_LAVADO)

const flujoPeor = sobre(T["tinta-media"], COBERTURA_PEOR, T.papel)
T["flujo-peor"] = flujoPeor
/* El vidrio pelado: lo que se ve del marco donde NO hay texto. */
T["vidrio-hero-peor"] = sobre(T.vidrio, ALFA_HERO, flujoPeor)
/* El vidrio con el lavado encima: lo que hay debajo de CADA letra del hero. */
T["vidrio-hero-lavado-peor"] = sobre(T.vidrio, ALFA_HERO_LAVADO, flujoPeor)
T["vidrio-pestana-peor"] = sobre(T.vidrio, ALFA_PESTANA, flujoPeor)
T["vidrio-pestana-abierta"] = sobre(T.vidrio, ALFA_PESTANA_ABIERTA, flujoPeor)
T["vidrio-hero-sin-soporte"] = sobre(T.vidrio, ALFA_HERO_SIN_SOPORTE, flujoPeor)
/* Y el mejor caso, que es el peor para un trazo AMARILLO sobre el vidrio. */
T["vidrio-hero-mejor"] = sobre(T.vidrio, ALFA_HERO, T.papel)

/** [texto, fondo, mínimo, qué es] */
const PARES = [
  ["tinta", "papel", 4.5, "cuerpo sobre papel"],
  ["tinta", "papel-alto", 4.5, "cuerpo sobre tarjeta"],
  ["tinta-media", "papel", 4.5, "secundario sobre papel"],
  ["tinta-media", "papel-alto", 4.5, "secundario sobre tarjeta"],
  ["tinta-tenue", "papel", 4.5, "terciario / placeholder sobre papel"],
  ["tinta-tenue", "papel-alto", 4.5, "terciario sobre tarjeta"],
  ["tinta", "papel-hondo", 4.5, "valor de input"],
  ["tinta-tenue", "papel-hondo", 4.5, "placeholder de input"],
  ["oro", "papel", 4.5, "AMARILLO COMO TEXTO sobre papel"],
  ["oro", "papel-alto", 4.5, "AMARILLO COMO TEXTO sobre tarjeta"],
  ["oro", "amarillo-palido", 4.5, "AMARILLO COMO TEXTO sobre lavado"],
  ["sobre-amarillo", "amarillo", 4.5, "TINTA SOBRE RELLENO AMARILLO"],
  ["sobre-amarillo", "amarillo-alto", 4.5, "tinta sobre amarillo hover"],
  ["tinta", "amarillo-palido", 4.5, "cuerpo sobre lavado"],
  ["tinta-media", "amarillo-palido", 4.5, "secundario sobre lavado"],
  ["foco", "papel", 3, "anillo de foco sobre papel"],
  ["foco", "papel-alto", 3, "anillo de foco sobre tarjeta"],
  ["punto-aro", "papel", 3, "ARO del punto de luz sobre papel (no-texto, 1.4.11)"],
  ["punto-aro", "papel-alto", 3, "ARO del punto de luz sobre tarjeta (no-texto)"],
  ["linea-control", "papel", 3, "borde de control sobre papel (no-texto, 1.4.11)"],
  ["linea-control", "papel-alto", 3, "borde de control sobre tarjeta"],

  /* ── VIDRIO · el peor momento del fondo animado ───────────────────
     TODO el texto del hero vive adentro de `.hero-titulo`, o sea sobre el
     vidrio MÁS el lavado. Los dos pares de abajo son los que mandan. */
  ["tinta", "vidrio-hero-lavado-peor", 4.5, "TÍTULO sobre vidrio + lavado, peor momento"],
  ["tinta-media", "vidrio-hero-lavado-peor", 4.5, "LEMA Y BAJADA sobre vidrio + lavado, peor momento"],
  /* Y el vidrio pelado, que es lo que se ve del marco donde no hay letras.
     `--tinta` aguanta igual; `--tinta-media` NO, y por eso la regla de
     DESIGN.md es que fuera del bloque de texto el hero no lleva texto. */
  ["tinta", "vidrio-hero-peor", 4.5, "tinta sobre el vidrio PELADO, peor momento"],
  ["tinta", "vidrio-hero-sin-soporte", 4.5, "título sin backdrop-filter (fallback)"],
  ["tinta-media", "vidrio-hero-sin-soporte", 4.5, "bajada sin backdrop-filter (fallback)"],
  ["tinta", "vidrio-pestana-peor", 4.5, "TÍTULO DE PESTAÑA sobre vidrio, peor momento"],
  ["tinta-media", "vidrio-pestana-peor", 4.5, "TEXTO DE PESTAÑA sobre vidrio, peor momento"],
  ["tinta-tenue", "vidrio-pestana-peor", 4.5, "orden de pestaña sobre vidrio, peor momento"],
  ["tinta-media", "vidrio-pestana-abierta", 4.5, "texto de pestaña ABIERTA, peor momento"],
  ["punto-aro", "vidrio-pestana-peor", 3, "trazo de la pestaña sobre su vidrio (no-texto)"],
  ["punto-aro", "vidrio-hero-mejor", 3, "trazo de la pestaña sobre vidrio limpio (no-texto)"],
  ["linea-control", "vidrio-hero-mejor", 3, "canto del marco sobre vidrio limpio (no-texto)"],
]

let fallos = 0
console.log("── compuestos ──")
for (const k of [
  "flujo-peor",
  "vidrio-hero-peor",
  "vidrio-hero-lavado-peor",
  "vidrio-pestana-peor",
  "vidrio-pestana-abierta",
  "vidrio-hero-sin-soporte",
  "vidrio-hero-mejor",
]) {
  console.log(`  ${k.padEnd(24)} ${T[k]}`)
}

console.log("\n── CLARO (único modo) ──")
for (const [t, f, min, que] of PARES) {
  const r = ratio(T[t], T[f])
  const ok = r >= min
  if (!ok) fallos += 1
  console.log(
    `${ok ? "ok  " : "FALLA"} ${r.toFixed(2).padStart(6)}:1  (min ${min})  ${t} / ${f} — ${que}`,
  )
}
console.log(`\n${fallos === 0 ? "TODO PASA" : `${fallos} FALLAN`}`)
process.exit(fallos === 0 ? 0 : 1)
