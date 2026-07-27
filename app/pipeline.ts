import { createMemoryStore } from "../adapters/store/memory.js"
import type { ExecutionResult } from "../adapters/executors/index.js"
import { detect, suppress } from "../engine/detector.js"
import { toIntervals } from "../engine/intervals.js"
import type {
  Action,
  Decision,
  Detection,
  DomainConfig,
  Interval,
  NormalizedEvent,
  Severity,
} from "../engine/schema.js"
import { simulateRestaurant } from "../simulators/restaurant.js"
import { simulateVolt } from "../simulators/volt-ocpp.js"
import { CONFIGS, DOMAIN_IDS, type DomainId } from "./domains.js"

/**
 * Todo lo que corre en el navegador vive acá: simulador → intervalos →
 * detección → supresión. Es código puro, sin React, sin fetch y sin reloj:
 * `page.tsx` le pasa los parámetros y él devuelve una foto completa de la
 * corrida. Así el pipeline se puede testear sin montar un DOM.
 */

/** Fin de la ventana simulada por defecto. Fijo a propósito: mismo seed → mismos timestamps. */
export const DEFAULT_AT = "2026-07-26T20:00:00.000Z"

/** Duración de la ventana simulada: 3 horas. */
export const WINDOW_MS = 3 * 60 * 60_000

/** Cuántas entidades genera cada dominio. */
export const ENTITY_COUNT: Record<DomainId, number> = { volt: 6, restaurant: 12 }

/** Tope de detecciones que llegan a decidir+ejecutar. Acota costo y tiempo de la demo. */
export const DEFAULT_MAX_DECISIONS = 3

export type OfflineMode =
  /** Todo en vivo: `/api/decide` y `/api/execute`. */
  | "off"
  /** Decisiones pregrabadas; la acción igual se ejecuta de verdad. */
  | "decide"
  /** Decisiones pregrabadas y ejecución simulada. Cero red saliente, cero créditos. */
  | "full"

export interface DemoParams {
  domain: DomainId
  seed: number
  offline: OfflineMode
  forceIncident: boolean
  maxDecisions: number
  /** ISO del instante en que se evalúa el motor. También el fin de la ventana. */
  at: string
}

export const DEFAULT_PARAMS: DemoParams = {
  domain: "volt",
  seed: 42,
  offline: "off",
  forceIncident: false,
  maxDecisions: DEFAULT_MAX_DECISIONS,
  at: DEFAULT_AT,
}

function isDomainId(value: string | null): value is DomainId {
  return value !== null && (DOMAIN_IDS as readonly string[]).includes(value)
}

function parseOffline(value: string | null): OfflineMode {
  if (value === null) return "off"
  if (value === "decide") return "decide"
  if (value === "0" || value === "" || value === "false") return "off"
  return "full"
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Lee `?domain=`, `?seed=`, `?offline=`, `?force=`, `?max=` y `?at=`.
 * Cualquier valor inválido cae al default en vez de romper: la demo nunca
 * debe quedarse en blanco por una URL mal tipeada.
 */
export function parseParams(search: string): DemoParams {
  const q = new URLSearchParams(search)
  const domain = q.get("domain")
  const at = q.get("at")

  return {
    domain: isDomainId(domain) ? domain : DEFAULT_PARAMS.domain,
    seed: parsePositiveInt(q.get("seed"), DEFAULT_PARAMS.seed),
    offline: parseOffline(q.get("offline")),
    forceIncident: q.get("force") === "1",
    maxDecisions: parsePositiveInt(q.get("max"), DEFAULT_MAX_DECISIONS),
    at: at !== null && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : DEFAULT_AT,
  }
}

/** El inverso de `parseParams`: sólo escribe lo que se aparta del default. */
export function toSearch(params: DemoParams): string {
  const q = new URLSearchParams()
  q.set("domain", params.domain)
  q.set("seed", String(params.seed))
  if (params.forceIncident) q.set("force", "1")
  if (params.offline === "full") q.set("offline", "1")
  if (params.offline === "decide") q.set("offline", "decide")
  if (params.maxDecisions !== DEFAULT_MAX_DECISIONS) q.set("max", String(params.maxDecisions))
  if (params.at !== DEFAULT_AT) q.set("at", params.at)
  return `?${q.toString()}`
}

/**
 * Qué vista del pipeline se está mirando.
 *
 * Vive aparte de `DemoParams` a propósito: `page.tsx` re-corre el motor (y
 * vuelve a pagarle a Claude) cada vez que cambia el objeto de params, y
 * cambiar de vista no debe re-correr nada.
 */
export type ViewMode = "simple" | "full"

export const DEFAULT_VIEW: ViewMode = "simple"

/** Lee `?view=`. Cualquier valor que no sea `full` cae en la vista simple. */
export function parseView(search: string): ViewMode {
  return new URLSearchParams(search).get("view") === "full" ? "full" : DEFAULT_VIEW
}

/** `toSearch` más la vista, para el `replaceState` de la página. */
export function toSearchWithView(params: DemoParams, view: ViewMode): string {
  const q = new URLSearchParams(toSearch(params))
  if (view !== DEFAULT_VIEW) q.set("view", view)
  return `?${q.toString()}`
}

export type SuppressionReason = "dedup" | "cooldown"

export interface ClassifiedDetection {
  detection: Detection
  /** Descripción de la regla que la disparó, para no repetir el lookup en la UI. */
  ruleDescription: string
  status: "pasa" | "suprimida" | "fuera-de-cupo"
  suppressedBy: SuppressionReason | null
}

export interface RunSnapshot {
  config: DomainConfig
  from: Date
  now: Date
  events: NormalizedEvent[]
  intervals: Interval[]
  classified: ClassifiedDetection[]
  /** Las detecciones que efectivamente van a decidir+ejecutar, en orden. */
  queued: Detection[]
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

function simulate(params: DemoParams, from: Date): NormalizedEvent[] {
  const common = {
    seed: params.seed,
    from,
    durationMs: WINDOW_MS,
    forceIncident: params.forceIncident,
  }
  return params.domain === "volt"
    ? simulateVolt({ ...common, stations: ENTITY_COUNT.volt })
    : simulateRestaurant({ ...common, tables: ENTITY_COUNT.restaurant })
}

/**
 * Corre el pipeline entero de una sola vez y devuelve la foto.
 *
 * Determinista por construcción: el seed fija los eventos y `params.at` fija
 * el instante de evaluación. Dos llamadas con los mismos params devuelven
 * exactamente lo mismo, hasta el timestamp.
 */
export function buildRun(params: DemoParams): RunSnapshot {
  const config = CONFIGS[params.domain]
  const now = new Date(params.at)
  const from = new Date(now.getTime() - WINDOW_MS)

  const events = simulate(params, from)
  const intervals = toIntervals(events, now)
  const detections = detect(events, config, now)

  // El store es la única fuente de verdad sobre por qué algo se suprimió: se
  // lo consulta después de `suppress` en vez de reimplementar su lógica acá.
  const store = createMemoryStore()
  const passed = new Set(suppress(detections, store, config, now))

  const descriptions = new Map(config.rules.map((r) => [r.id, r.description]))

  const classified: ClassifiedDetection[] = detections.map((detection) => {
    if (passed.has(detection)) {
      return {
        detection,
        ruleDescription: descriptions.get(detection.ruleId) ?? detection.ruleId,
        status: "pasa",
        suppressedBy: null,
      }
    }
    // Si su propio dedupKey ya quedó marcado, otra detección idéntica pasó
    // antes (dedup). Si no, la frenó la ventana de cooldown de la entidad.
    const suppressedBy: SuppressionReason = store.lastFiredAt(detection.dedupKey)
      ? "dedup"
      : "cooldown"
    return {
      detection,
      ruleDescription: descriptions.get(detection.ruleId) ?? detection.ruleId,
      status: "suprimida",
      suppressedBy,
    }
  })

  // Orden estable: primero lo grave, y dentro de cada severidad el orden en
  // que las reglas están declaradas en el config.
  const ordered = classified
    .filter((c) => c.status === "pasa")
    .map((c, index) => ({ c, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.c.detection.severity] - SEVERITY_ORDER[b.c.detection.severity] ||
        a.index - b.index,
    )
    .map((x) => x.c)

  const queued = ordered.slice(0, params.maxDecisions).map((c) => c.detection)
  const queuedSet = new Set(queued)
  for (const c of classified) {
    if (c.status === "pasa" && !queuedSet.has(c.detection)) c.status = "fuera-de-cupo"
  }

  return { config, from, now, events, intervals, classified, queued }
}

/**
 * Decisiones pregrabadas para `?offline=1`.
 *
 * Es el seguro de la demo: sin wifi, con la API caída o con rate limit, el
 * pipeline llega igual hasta el final. El juicio (qué acción) está grabado;
 * `{entidad}` se reemplaza por el id concreto para que la tarjeta no mienta
 * sobre a quién se refiere. El sustantivo del dominio va en el texto de cada
 * plantilla, que ya es por dominio.
 */
export const OFFLINE_DECISIONS: Record<string, Decision> = {
  "volt:faulted-stuck": {
    actionId: "alert-ops",
    reason: "Falla persistente en una estación: pierde ingreso y deja conductores varados.",
    message:
      "La estación {entidad} lleva más de 10 minutos en Faulted y no se recupera sola. Hay que despachar un técnico.",
  },
  "volt:offline": {
    actionId: "alert-ops",
    reason: "Sin heartbeat: no sabemos si está cargando, caída o vandalizada.",
    message: "La estación {entidad} dejó de reportar. Nadie sabe en qué estado quedó.",
  },
  "volt:long-session": {
    actionId: "create-ticket",
    reason: "Sesión anómala frente a su propio histórico: revisar sin urgencia.",
    message:
      "La estación {entidad} lleva una sesión de carga muy por encima de lo normal para ella. Vale una revisión.",
  },
  "volt:demand-spike": {
    actionId: "ignore",
    reason: "Un pico de demanda no es una falla: es la red funcionando.",
    message: "Pico de demanda concentrado en la zona {entidad}. Sin acción.",
  },
  "restaurant:no-show": {
    actionId: "avisar-dueno",
    reason: "En hora pico una reserva sin check-in es plata parada.",
    message:
      "La {entidad} sigue reservada y nadie llegó. Si en unos minutos no aparecen, conviene liberarla.",
  },
  "restaurant:sobremesa": {
    actionId: "ignore",
    reason: "Una sobremesa larga es un cliente contento, no un problema.",
    message: "La {entidad} lleva rato ocupada. Sin acción.",
  },
  "restaurant:rush": {
    actionId: "avisar-dueno",
    reason: "Varias mesas ocupándose a la vez: el salón se va a saturar.",
    message: "Se están ocupando varias mesas al mismo tiempo. Conviene reforzar el salón.",
  },
}

/** La acción de descarte del dominio, o la primera declarada si no hay ninguna. */
function fallbackActionId(config: DomainConfig): string {
  const ignore = config.actions.find((a) => a.type === "noop")
  return (ignore ?? config.actions[0])?.id ?? "ignore"
}

export function offlineDecision(
  domain: DomainId,
  detection: Detection,
  config: DomainConfig,
): Decision {
  const recorded = OFFLINE_DECISIONS[`${domain}:${detection.ruleId}`]

  if (!recorded) {
    return {
      actionId: fallbackActionId(config),
      reason: `No hay decisión pregrabada para la regla "${detection.ruleId}".`,
      message: `Sin decisión pregrabada para ${config.entity.singular} ${detection.entityId}.`,
    }
  }

  return {
    ...recorded,
    message: recorded.message.replaceAll("{entidad}", detection.entityId),
  }
}

/**
 * Ejecución simulada para `?offline=1`: describe lo que habría pasado sin
 * tocar la red. La UI la marca como simulada — nunca se presenta como real.
 */
export function simulatedExecution(action: Action | undefined): ExecutionResult {
  if (!action) return { ok: false, detail: "acción desconocida" }
  if (action.type === "noop") return { ok: true, detail: "sin acción (noop)" }
  return { ok: true, detail: `simulado: ${action.type} → ${action.id}` }
}

export function findAction(config: DomainConfig, actionId: string): Action | undefined {
  return config.actions.find((a) => a.id === actionId)
}

/** "1 h 12 min" / "30 min" / "45 s". Sin locale: mismo texto en cualquier máquina. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** "19:30" en UTC, leído del ISO. Sin `toLocale*`: el mismo seed se ve igual en toda máquina. */
export function formatClock(iso: string): string {
  return iso.slice(11, 16)
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Nombres en español para las claves de evidencia que producen las reglas. */
const EVIDENCE_LABELS: Record<string, string> = {
  state: "estado",
  durationMs: "duración",
  thresholdMs: "umbral",
  startedAt: "desde",
  baselineMs: "referencia",
  percentile: "percentil",
  samples: "muestras",
  lastSeenAt: "último evento",
  silentForMs: "en silencio",
  windowMs: "ventana",
  count: "ocurrencias",
  threshold: "umbral",
  groupBy: "agrupado por",
}

export function evidenceLabel(key: string): string {
  return EVIDENCE_LABELS[key] ?? key
}

/** Convierte un valor de evidencia en texto legible sin depender del locale. */
export function formatEvidenceValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "number") return key.endsWith("Ms") ? formatDuration(value) : String(value)
  if (typeof value === "string") {
    return ISO_DATETIME.test(value) ? `${formatClock(value)} UTC` : value
  }
  if (typeof value === "boolean") return value ? "sí" : "no"
  return JSON.stringify(value)
}

export function formatEvidence(evidence: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(evidence).map(([key, value]) => ({
    label: evidenceLabel(key),
    value: formatEvidenceValue(key, value),
  }))
}
