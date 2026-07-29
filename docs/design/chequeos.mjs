/*
 * Los cinco chequeos manuales, corridos contra el build de producción con un
 * navegador de verdad. Uso: node docs/design/chequeos.mjs [baseUrl]
 * No es parte del build ni del bundle: es la herramienta de verificación.
 */
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright")

const BASE = process.argv[2] ?? "http://localhost:3111"
const navegador = await chromium.launch()
const resultados = []
const anotar = (nombre, ok, detalle) => {
  resultados.push({ nombre, ok, detalle })
  console.log(`${ok ? "PASA " : "FALLA"} ${nombre} — ${detalle}`)
}

const abrir = async (url, opciones = {}) => {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const pedidos = []
  p.on("request", (r) => pedidos.push(r.url()))
  await p.goto(BASE + url, { waitUntil: "domcontentloaded" })
  await p.waitForTimeout(opciones.espera ?? 3000)
  return { ctx, p, pedidos }
}

// 1 · los cinco carriles se pueblan para volt
{
  const { ctx, p } = await abrir("/?offline=1&view=full")
  const cuentas = await p.$$eval("[data-count]", (n) => n.map((e) => Number(e.textContent)))
  const carriles = await p.$$eval("[data-lane]", (n) => n.map((e) => e.dataset.lane))
  anotar(
    "1 · cinco carriles poblados (volt)",
    cuentas.length === 5 && cuentas.every((c) => c > 0),
    `${carriles.join(",")} → ${cuentas.join(",")}`,
  )
  await ctx.close()
}

// 2 · forzar incidente produce faulted-stuck
{
  const { ctx, p } = await abrir("/?offline=1&force=1&view=full")
  const reglas = await p.$$eval("[data-rule]", (n) => n.map((e) => e.dataset.rule))
  anotar(
    "2 · ?force=1 → faulted-stuck",
    reglas.includes("faulted-stuck"),
    `reglas: ${[...new Set(reglas)].join(", ") || "(ninguna)"}`,
  )
  await ctx.close()
}

// 3 · restaurant dice "mesa" y nunca "estación"
{
  const { ctx, p } = await abrir("/?offline=1&domain=restaurant&view=full")
  // El panel de controles queda afuera a propósito: el selector de dominio
  // TIENE que poder nombrar al otro dominio ("VOLT — Estaciones de carga").
  // Lo que se chequea es el contenido de la corrida.
  const texto = await p.evaluate(() => {
    const main = document.querySelector("main").cloneNode(true)
    main.querySelector(".consola-panel")?.remove()
    return main.innerText
  })
  const dice = /mesa/i.test(texto)
  const noDice = !/estaci[oó]n/i.test(texto)
  anotar(
    '3 · restaurant dice "mesa", nunca "estación" (fuera del selector)',
    dice && noDice,
    `mesa=${dice} sin-estación=${noDice}`,
  )
  await ctx.close()
}

// 4 · misma semilla dos veces → eventos idénticos
{
  const leer = async () => {
    const { ctx, p } = await abrir("/?offline=1&seed=7&view=full")
    const t = await p.$$eval('[data-card="evento"]', (n) =>
      n.map((e) => `${e.dataset.entity}|${e.dataset.state}|${e.textContent}`).join("\n"),
    )
    await ctx.close()
    return t
  }
  const a = await leer()
  const b = await leer()
  anotar(
    "4 · misma semilla → corrida idéntica",
    a === b && a.length > 0,
    `${a.split("\n").length} eventos, byte-idénticos`,
  )
}

// 5 · ?offline=1 no hace un solo pedido a /api/*
{
  const { ctx, pedidos } = await abrir("/?offline=1")
  const api = pedidos.filter((u) => u.includes("/api/"))
  anotar("5 · ?offline=1 → cero pedidos a /api/*", api.length === 0, `${api.length} pedidos`)
  await ctx.close()
}

// Extra · ningún error de consola en la carga limpia
{
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errores = []
  p.on("console", (m) => m.type() === "error" && errores.push(m.text()))
  p.on("pageerror", (e) => errores.push(String(e)))
  await p.goto(`${BASE}/?offline=1`, { waitUntil: "networkidle" })
  await p.waitForTimeout(2500)
  anotar("extra · consola limpia", errores.length === 0, errores.join(" | ") || "sin errores")
  await ctx.close()
}

await navegador.close()
console.log(
  `\n${resultados.filter((r) => r.ok).length}/${resultados.length} pasan`,
)
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
