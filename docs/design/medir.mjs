/*
 * Mide las cajas reales del layout. No saca fotos: imprime números.
 *
 * Uso:
 *   node docs/design/medir.mjs [url]
 *
 * POR QUÉ EXISTE, aparte de `mirar.mjs`.
 *
 * `mirar.mjs` saca capturas, que sirven para juicios estéticos —"el amarillo
 * es muy fuerte", "falta aire"—. Para bugs de layout no alcanzan: una captura
 * es la salida final de layout + pintado + composición, así que muestra el
 * SÍNTOMA pero no dice qué elemento lo produce.
 *
 * El layout de los cinco carriles llevó cuatro intentos. Los tres primeros
 * fueron mirar una captura, suponer cuál elemento se desbordaba y cambiar CSS;
 * los tres fallaron, y uno rompió algo que ya andaba sin que la captura
 * siguiente lo delatara. El cuarto salió de esta salida:
 *
 *     .hoja   min-height: 947px  →  alto real 6675px
 *     .escena flex: 1 1 0%       →  alto real 6571px
 *
 * Ahí el diagnóstico dejó de ser hipótesis: `min-height` no restringía nada,
 * así que `flex: 1` repartía todo el contenido en vez de lo que sobraba.
 *
 * LAS TRES LECTURAS QUE RESUELVEN CASI TODO
 *
 *  · `scrollAlto` vs `clientAlto` — iguales significa que el contenedor creció
 *    con su contenido y no recorta nada; distintos, que sí recorta y hay
 *    scroll. Ese par solo distingue "la lista es larga" de "el contenedor no
 *    la limita", que es la pregunta de fondo en todo desborde.
 *
 *  · lo COMPUTADO vs lo que escribiste — `height: 6675px` donde pusiste
 *    `min-height: 100svh` es la prueba de que la propiedad no hace lo que
 *    creías.
 *
 *  · los `bottom` consecutivos — `.carriles bottom` y `.pie top` iguales es
 *    hueco cero; distintos, te dicen cuántos píxeles muertos buscar.
 */
import { createRequire } from "node:module"

/* playwright no es dependencia del proyecto: se corre con `npx playwright` y
   se resuelve desde donde npm lo haya dejado. PLAYWRIGHT_DIR lo puede fijar
   a mano si hace falta. Ver docs/design/README.md. */
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright")

const URL_POR_DEFECTO = "http://localhost:3000/?domain=restaurant&seed=42&offline=1&view=full"
const url = process.argv[2] ?? URL_POR_DEFECTO

/* Los sospechosos habituales, de afuera hacia adentro. Medir la CADENA entera
   de ancestros y no sólo el elemento que se ve mal: el que desborda casi nunca
   es el culpable, y agregar ancestros a la lista no cuesta nada. */
const SELECTORES = ["main", ".hoja", ".escena", ".carriles", ".pie", ".mascota"]

const navegador = await chromium.launch()
const pagina = await navegador.newPage({ viewport: { width: 1920, height: 947 } })
await pagina.goto(url, { waitUntil: "domcontentloaded" })

/* Esperar a que la corrida TERMINE. Con un tiempo fijo corto las medidas salen
   a mitad del pipeline, cuando faltan carriles por poblar, y mienten. */
await pagina
  .waitForSelector('.estado-corrida[data-fase="listo"]', { timeout: 20000 })
  .catch(() => console.error("· aviso: la corrida no llegó a 'listo'; las medidas pueden ser parciales"))
await pagina.waitForTimeout(600)

const datos = await pagina.evaluate((selectores) => {
  const caja = (sel) => {
    const n = document.querySelector(sel)
    if (n === null) return { sel, ausente: true }
    const r = n.getBoundingClientRect()
    const cs = getComputedStyle(n)
    return {
      sel,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      alto: Math.round(r.height),
      // El par que dice si recorta o no.
      scrollAlto: n.scrollHeight,
      clientAlto: n.clientHeight,
      // Lo COMPUTADO, no lo declarado.
      height: cs.height,
      minHeight: cs.minHeight,
      flex: cs.flex,
      display: cs.display,
      alignItems: cs.alignItems,
      alignSelf: cs.alignSelf,
      justifySelf: cs.justifySelf,
      overflowY: cs.overflowY,
    }
  }

  const carriles = [...document.querySelectorAll(".carril")].map((n) => {
    const r = n.getBoundingClientRect()
    const lista = n.querySelector("ol")
    return {
      carril: n.getAttribute("data-lane") ?? "?",
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      alto: Math.round(r.height),
      lista:
        lista === null
          ? null
          : {
              // clientAlto < scrollAlto = la lista scrollea adentro de su celda,
              // que es lo que se busca en la vista completa.
              clientAlto: lista.clientHeight,
              scrollAlto: lista.scrollHeight,
              overflowY: getComputedStyle(lista).overflowY,
            },
    }
  })

  return {
    viewport: { ancho: innerWidth, alto: innerHeight },
    docAlto: document.documentElement.scrollHeight,
    cajas: selectores.map(caja),
    carriles,
  }
}, SELECTORES)

console.log(JSON.stringify(datos, null, 2))
await navegador.close()
