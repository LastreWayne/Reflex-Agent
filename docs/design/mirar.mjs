/*
 * Mira la página con un navegador de verdad y saca las fotos.
 * Uso: node docs/design/mirar.mjs [baseUrl]
 * No es parte del build ni del bundle: es la herramienta de verificación.
 */
import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"

/* playwright no es dependencia del proyecto: se corre con `npx playwright` y
   se resuelve desde donde npm lo haya dejado. PLAYWRIGHT_DIR lo puede fijar
   a mano si hace falta. */
const require = createRequire(import.meta.url)

const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright")

/*
 * Congelar antes de sacar la foto.
 *
 * Con el campo de flujo corriendo, `page.screenshot()` espera un cuadro
 * estable que nunca llega y termina colgada. La opción `animations:
 * "disabled"` de Playwright no sirve acá: cancela las animaciones infinitas
 * al estado INICIAL, y en ese estado los 72 trazos están todos en fase,
 * amontonados — o sea, la foto mentiría sobre cómo se ve la página.
 *
 * Se las pausa a mano con la Web Animations API después de dejarlas correr:
 * quedan congeladas en un momento representativo y la captura es inmediata.
 */
const congelar = (p) =>
  p.evaluate(() => {
    for (const a of document.getAnimations()) a.pause()
  })

const BASE = process.argv[2] ?? "http://localhost:3111"
const SALIDA = "docs/design/fotos"
mkdirSync(SALIDA, { recursive: true })

const VISTAS = [
  { nombre: "escritorio", ancho: 1440, alto: 900 },
  { nombre: "portatil", ancho: 1280, alto: 720 },
  { nombre: "tableta", ancho: 834, alto: 1112 },
  { nombre: "telefono", alto: 844, ancho: 390 },
]

/* Con rasterizado por GPU: sin esto el headless cae a software y los fps
   medidos no dicen nada del navegador de una persona. */
const navegador = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-gpu-rasterization"],
})

for (const modo of ["light"]) {
  for (const v of VISTAS) {
    const ctx = await navegador.newContext({
      viewport: { width: v.ancho, height: v.alto },
      colorScheme: modo,
      deviceScaleFactor: 2,
    })
    const p = await ctx.newPage()
    const errores = []
    p.on("console", (m) => {
      if (m.type() === "error") errores.push(m.text())
    })
    p.on("pageerror", (e) => errores.push(String(e)))

    await p.goto(`${BASE}/?offline=1`, { waitUntil: "domcontentloaded" })
    // Esperar a que la corrida TERMINE, no un tiempo fijo: con un timeout la
    // foto salía a mitad del pipeline y mentía sobre el estado.
    await p.waitForSelector('.estado-corrida[data-fase="listo"]', { timeout: 15000 })
    await p.waitForTimeout(400)

    // 1 · el primer frame, exactamente lo que entra en la pantalla
    await congelar(p)
    await p.screenshot({ timeout: 90000, path: `${SALIDA}/${modo}-${v.nombre}-1-portada.png` })
    // 2 · la página entera
    await congelar(p)
    await p.screenshot({ timeout: 90000, path: `${SALIDA}/${modo}-${v.nombre}-2-todo.png`, fullPage: true })

    if (errores.length) console.log(`  consola ${modo}/${v.nombre}:`, errores.slice(0, 3))

    // Qué queda por debajo del pliegue: control duro del pedido del humano.
    if (v.nombre === "escritorio" || v.nombre === "telefono") {
      const fuera = await p.evaluate((alto) => {
        const dentro = (sel) => {
          const el = document.querySelector(sel)
          if (!el) return "ausente"
          const r = el.getBoundingClientRect()
          return r.top < alto ? `DENTRO (top ${Math.round(r.top)})` : "fuera"
        }
        return {
          titulo: dentro(".titular"),
          pestanas: dentro(".pestanas"),
          escena: dentro(".escena"),
          banda: dentro(".banda"),
          mascota: dentro(".mascota"),
          scrollLateral:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
          altoPortada: Math.round(
            document.querySelector(".portada")?.getBoundingClientRect().height ?? 0,
          ),
        }
      }, v.alto)
      console.log(`${modo}/${v.nombre}`, JSON.stringify(fuera))
    }

    await ctx.close()
  }
}

/* Estados que no se ven en la carga limpia: los cinco carriles, los controles
   abiertos, el incidente forzado y el foco de teclado. */
const ESCENAS = [
  { nombre: "cinco-carriles", url: "/?offline=1&view=full" },
  { nombre: "forzado", url: "/?offline=1&force=1" },
  { nombre: "restaurant", url: "/?offline=1&domain=restaurant" },
  { nombre: "controles", url: "/?offline=1", abrir: true },
  { nombre: "foco", url: "/?offline=1", foco: true },
  /* Media corrida: carriles todavía vacíos / cargando. */
  { nombre: "temprano", url: "/?offline=1&view=full", espera: 420 },
]

/* Estados de la portada: pestaña abierta por puntero y por teclado. */
for (const caso of ["pestana-hover", "pestana-teclado", "sin-movimiento"]) {
  const ctx = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: caso === "sin-movimiento" ? "reduce" : "no-preference",
  })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/?offline=1`, { waitUntil: "domcontentloaded" })
  await p.waitForTimeout(2200)
  if (caso === "pestana-hover") await p.hover('[data-action="camino-detecciones"]')
  if (caso === "pestana-teclado") await p.focus('[data-action="camino-decision"]')
  await p.waitForTimeout(700)
  await congelar(p)
    await p.screenshot({ timeout: 90000, path: `${SALIDA}/light-${caso}.png` })
  await ctx.close()
}

for (const modo of ["light"]) {
  for (const e of ESCENAS) {
    const ctx = await navegador.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: modo,
      deviceScaleFactor: 2,
    })
    const p = await ctx.newPage()
    await p.goto(BASE + e.url, { waitUntil: "domcontentloaded" })
    await p.waitForTimeout(e.espera ?? 2200)
    if (e.abrir) {
      await p.click('[data-action="controles"]')
      await p.waitForTimeout(500)
    }
    if (e.foco) {
      await p.click('[data-action="camino-eventos"]')
      await p.waitForTimeout(900)
      await p.keyboard.press("Tab")
      await p.keyboard.press("Tab")
    }
    await p.evaluate(() => document.querySelector(".escena")?.scrollIntoView())
    await p.waitForTimeout(600)
    await congelar(p)
    await p.screenshot({ timeout: 90000, path: `${SALIDA}/${modo}-${e.nombre}.png` })
    await ctx.close()
  }
}

/* Medidas duras: qué se desborda y qué se sale de su caja. */
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.goto(`${BASE}/?offline=1`, { waitUntil: "networkidle" })
await p.waitForTimeout(2000)
console.log(
  "\nmedidas",
  JSON.stringify(
    await p.evaluate(() => {
      const t = document.querySelector(".titular-nombre")
      const desbordan = [...document.querySelectorAll("body *")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "auto")
        .map((el) => el.className)
        .slice(0, 6)
      return {
        anchoTitulo: Math.round(t.getBoundingClientRect().width),
        pxTitulo: getComputedStyle(t).fontSize,
        anchoDisponible: Math.round(
          document.querySelector(".hero-titulo").getBoundingClientRect().width,
        ),
        desbordan,
      }
    }),
    null,
    0,
  ),
)
await ctx.close()

/* Cuánto cuesta el campo de flujo. Cuenta cuadros durante 3 s con el hero a
   la vista: si esto baja de ~50 fps hay que sacarle líneas al fondo. */
{
  const c = await navegador.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await c.newPage()
  await p.goto(`${BASE}/?offline=1`, { waitUntil: "networkidle" })
  await p.waitForTimeout(2500)
  const fps = await p.evaluate(
    () =>
      new Promise((listo) => {
        let cuadros = 0
        const arranque = performance.now()
        const paso = () => {
          cuadros += 1
          if (performance.now() - arranque < 3000) requestAnimationFrame(paso)
          else listo(Math.round((cuadros * 1000) / (performance.now() - arranque)))
        }
        requestAnimationFrame(paso)
      }),
  )
  const trazos = await p.$$eval(".flujo-linea", (n) => n.length)
  console.log(`\nfondo de flujo: ${trazos} trazos animados · ${fps} fps`)
  await c.close()
}

await navegador.close()
console.log(`\nfotos en ${SALIDA}`)
