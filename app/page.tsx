"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import type { ExecutionResult } from "../adapters/executors/index.js"
import type { Decision, Detection, DomainConfig } from "../engine/schema.js"
import { CONFIGS, DOMAIN_IDS } from "./domains.js"
import {
  buildRun,
  findAction,
  formatClock,
  formatDuration,
  formatEvidence,
  offlineDecision,
  parseParams,
  simulatedExecution,
  toSearch,
  type DemoParams,
  type RunSnapshot,
} from "./pipeline.js"

/*
 * El pipeline entero de detección corre ACÁ, en el navegador: /engine no
 * importa nada de Node ni toca la red, así que el simulador, `toIntervals`,
 * `detect` y `suppress` se ejecutan del lado del cliente. Lo único que sale
 * al servidor es la decisión de Claude (necesita la clave) y la ejecución de
 * la acción (necesita los secretos de los destinos).
 *
 * `process.env` no aparece en este archivo ni en nada que importe. Si
 * apareciera, se filtraría al bundle público.
 */

/** Pausa entre carriles, para que el pipeline se lea como un pipeline. */
const PASO_MS = 350

const SEVERIDAD: Record<string, string> = { high: "alta", medium: "media", low: "baja" }

const ESTADO_DETECCION: Record<string, string> = {
  pasa: "pasa a decisión",
  suprimida: "suprimida",
  "fuera-de-cupo": "fuera del cupo de la demo",
}

const MOTIVO_SUPRESION: Record<string, string> = {
  dedup: "ya se alertó por esta misma ocurrencia",
  cooldown: "dentro de la ventana de silencio de la entidad",
}

type DecisionStatus = "pendiente" | "lista" | "error"
type AccionStatus = "pendiente" | "ok" | "fallo" | "omitida"

interface DecisionCard {
  key: string
  detection: Detection
  status: DecisionStatus
  source: "claude" | "pregrabada"
  decision: Decision | null
  error: string | null
}

interface AccionCard {
  key: string
  entityId: string
  actionId: string
  actionType: string
  actionDescription: string
  status: AccionStatus
  source: "real" | "simulada"
  detail: string | null
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export default function Page() {
  const [params, setParams] = useState<DemoParams | null>(null)
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null)
  /** Cuántos carriles ya se encendieron: 1 eventos … 5 acción. */
  const [carriles, setCarriles] = useState(0)
  const [decisiones, setDecisiones] = useState<DecisionCard[]>([])
  const [acciones, setAcciones] = useState<AccionCard[]>([])
  const [fallo, setFallo] = useState<string | null>(null)

  // Los params se leen de la URL recién montado el componente: en el render
  // del servidor no hay `window`, y leerlo antes daría un mismatch.
  useEffect(() => {
    setParams(parseParams(window.location.search))
  }, [])

  const corridaRef = useRef(0)
  const ultimaRef = useRef<DemoParams | null>(null)

  useEffect(() => {
    if (params === null) return
    // React en modo estricto invoca el efecto dos veces con los MISMOS params.
    // Sin esta guarda, cada carga dispararía el decisor dos veces — o sea el
    // doble de llamadas pagas. Cada control crea un objeto nuevo, así que un
    // cambio real siempre pasa.
    if (ultimaRef.current === params) return
    ultimaRef.current = params

    const token = corridaRef.current + 1
    corridaRef.current = token
    const vivo = () => corridaRef.current === token

    window.history.replaceState(null, "", toSearch(params))
    setSnapshot(null)
    setCarriles(0)
    setDecisiones([])
    setAcciones([])
    setFallo(null)

    void (async () => {
      let snap: RunSnapshot
      try {
        snap = buildRun(params)
      } catch (error) {
        if (vivo()) setFallo(`No se pudo correr el motor: ${(error as Error).message}`)
        return
      }
      if (!vivo()) return

      setSnapshot(snap)
      setCarriles(1)
      await sleep(PASO_MS)
      if (!vivo()) return
      setCarriles(2)
      await sleep(PASO_MS)
      if (!vivo()) return
      setCarriles(3)
      await sleep(PASO_MS)
      if (!vivo()) return
      setCarriles(4)

      for (const detection of snap.queued) {
        const key = detection.dedupKey
        const source = params.offline === "off" ? "claude" : "pregrabada"

        setDecisiones((prev) => [
          ...prev,
          { key, detection, status: "pendiente", source, decision: null, error: null },
        ])

        const { decision, error } = await pedirDecision(params, detection, snap.config)
        if (!vivo()) return
        setDecisiones((prev) =>
          prev.map((c) =>
            c.key === key
              ? { ...c, status: decision ? "lista" : "error", decision, error }
              : c,
          ),
        )
        setCarriles(5)

        if (!decision) {
          setAcciones((prev) => [
            ...prev,
            {
              key,
              entityId: detection.entityId,
              actionId: "—",
              actionType: "—",
              actionDescription: "No hubo decisión, así que no hay nada que ejecutar.",
              status: "omitida",
              source: params.offline === "full" ? "simulada" : "real",
              detail: "omitida",
            },
          ])
          continue
        }

        const action = findAction(snap.config, decision.actionId)
        setAcciones((prev) => [
          ...prev,
          {
            key,
            entityId: detection.entityId,
            actionId: decision.actionId,
            actionType: action?.type ?? "desconocida",
            actionDescription: action?.description ?? "La acción elegida no existe en el config.",
            status: "pendiente",
            source: params.offline === "full" ? "simulada" : "real",
            detail: null,
          },
        ])

        const result = await ejecutar(params, detection, decision, snap)
        if (!vivo()) return
        setAcciones((prev) =>
          prev.map((c) =>
            c.key === key ? { ...c, status: result.ok ? "ok" : "fallo", detail: result.detail } : c,
          ),
        )
      }

      if (!vivo()) return
      setCarriles(5)
    })()
  }, [params])

  const cambiar = (patch: Partial<DemoParams>) => {
    setParams((prev) => (prev === null ? prev : { ...prev, ...patch }))
  }

  const config: DomainConfig | null = params ? CONFIGS[params.domain] : null
  const listo = carriles >= 5 && decisiones.every((d) => d.status !== "pendiente")
  const decididas = decisiones.filter((d) => d.status !== "pendiente").length

  return (
    <main>
      <h1>Centinela — el mismo motor, dos dominios</h1>
      <p className="subtitulo">
        El simulador, los intervalos, las reglas y la supresión corren en tu navegador. Sólo la
        decisión de Claude y la ejecución de la acción pasan por el servidor.
      </p>

      {params && (
        <div className="controles">
          <fieldset>
            <legend>Dominio</legend>
            {DOMAIN_IDS.map((id) => (
              <button
                key={id}
                type="button"
                data-action={`dominio-${id}`}
                aria-pressed={params.domain === id}
                onClick={() => cambiar({ domain: id, forceIncident: false })}
              >
                {CONFIGS[id].displayName}
              </button>
            ))}
          </fieldset>

          <fieldset>
            <legend>
              <label htmlFor="seed">Semilla</label>
            </legend>
            <input
              id="seed"
              type="number"
              min={1}
              value={params.seed}
              data-action="semilla"
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10)
                if (Number.isFinite(next) && next > 0) cambiar({ seed: next })
              }}
            />
          </fieldset>

          <button
            type="button"
            data-action="forzar-incidente"
            aria-pressed={params.forceIncident}
            onClick={() => cambiar({ forceIncident: true })}
          >
            Forzar incidente
          </button>

          {/* Reiniciar vuelve a la corrida normal y la re-ejecuta: es el
              inverso de "Forzar incidente". `cambiar` siempre crea un objeto
              nuevo, así que el pipeline arranca de cero aunque nada cambie. */}
          <button
            type="button"
            data-action="reiniciar"
            onClick={() => cambiar({ forceIncident: false })}
          >
            Reiniciar
          </button>

          <fieldset>
            <legend>
              <label htmlFor="offline">Modo offline</label>
            </legend>
            <input
              id="offline"
              type="checkbox"
              data-action="offline"
              checked={params.offline !== "off"}
              onChange={(e) => cambiar({ offline: e.target.checked ? "full" : "off" })}
            />
          </fieldset>
        </div>
      )}

      <p className="estado-corrida" data-fase={listo ? "listo" : snapshot ? "corriendo" : "inicio"}>
        {fallo ? (
          <strong data-error="motor">{fallo}</strong>
        ) : !params || !snapshot || !config ? (
          "Preparando la corrida…"
        ) : (
          <>
            <strong>{config.displayName}</strong> · semilla {params.seed} ·{" "}
            {snapshot.events.length} eventos sobre {config.entity.plural} · ventana{" "}
            <time dateTime={snapshot.from.toISOString()}>
              {formatClock(snapshot.from.toISOString())}
            </time>
            –
            <time dateTime={snapshot.now.toISOString()}>
              {formatClock(snapshot.now.toISOString())}
            </time>{" "}
            UTC ·{" "}
            <span data-modo={params.offline}>
              {params.offline === "off"
                ? "en vivo (Claude decide)"
                : params.offline === "decide"
                  ? "offline: decisiones pregrabadas, acciones reales"
                  : "offline: decisiones pregrabadas, acciones simuladas"}
            </span>
            {params.forceIncident && <span data-modo="forzado"> · incidente forzado</span>} ·{" "}
            {listo ? "listo" : `decidiendo ${decididas}/${snapshot.queued.length}`}
          </>
        )}
      </p>

      <div className="carriles">
        <Carril
          id="eventos"
          orden={1}
          titulo="Eventos"
          descripcion={`Lo que reporta ${config ? `cada ${config.entity.singular}` : "cada entidad"}`}
          total={snapshot && carriles >= 1 ? snapshot.events.length : 0}
          activo={carriles >= 1}
        >
          {snapshot &&
            carriles >= 1 &&
            snapshot.events.map((e, i) => (
              <li
                key={`ev-${i}`}
                className="tarjeta"
                data-card="evento"
                data-entity={e.entityId}
                data-state={e.state}
              >
                <span className="titulo">{e.entityId}</span>{" "}
                <span className="etiqueta">{e.state}</span>{" "}
                <time dateTime={e.timestamp}>{formatClock(e.timestamp)}</time>
              </li>
            ))}
        </Carril>

        <Carril
          id="intervalos"
          orden={2}
          titulo="Intervalos"
          descripcion="Cuánto duró cada estado"
          total={snapshot && carriles >= 2 ? snapshot.intervals.length : 0}
          activo={carriles >= 2}
        >
          {snapshot &&
            carriles >= 2 &&
            snapshot.intervals.map((iv, i) => (
              <li
                key={`iv-${i}`}
                className="tarjeta"
                data-card="intervalo"
                data-entity={iv.entityId}
                data-state={iv.state}
                data-open={iv.isOpen ? "si" : "no"}
              >
                <span className="titulo">{iv.entityId}</span>{" "}
                <span className="etiqueta">{iv.state}</span>
                <dl>
                  <dt>desde</dt>
                  <dd>
                    <time dateTime={iv.startedAt}>{formatClock(iv.startedAt)}</time>
                  </dd>
                  <dt>duró</dt>
                  <dd>
                    {formatDuration(iv.durationMs)}
                    {iv.isOpen ? " (abierto)" : ""}
                  </dd>
                </dl>
              </li>
            ))}
        </Carril>

        <Carril
          id="detecciones"
          orden={3}
          titulo="Detecciones"
          descripcion="Reglas que dispararon, y cuáles se silenciaron"
          total={snapshot && carriles >= 3 ? snapshot.classified.length : 0}
          activo={carriles >= 3}
        >
          {snapshot &&
            carriles >= 3 &&
            snapshot.classified.map((c, i) => (
              <li
                key={`dt-${i}`}
                className="tarjeta"
                data-card="deteccion"
                data-status={c.status}
                data-severity={c.detection.severity}
                data-rule={c.detection.ruleId}
                data-entity={c.detection.entityId}
              >
                <span className="titulo">{c.detection.ruleId}</span>{" "}
                <span className="etiqueta" data-severity={c.detection.severity}>
                  severidad {SEVERIDAD[c.detection.severity] ?? c.detection.severity}
                </span>
                <p>{c.ruleDescription}</p>
                <dl>
                  <dt>{snapshot.config.entity.singular}</dt>
                  <dd>{c.detection.entityId}</dd>
                  {formatEvidence(c.detection.evidence).map((row) => (
                    <Fila key={row.label} label={row.label} value={row.value} />
                  ))}
                  <dt>estado</dt>
                  <dd>
                    {ESTADO_DETECCION[c.status] ?? c.status}
                    {c.suppressedBy ? ` — ${MOTIVO_SUPRESION[c.suppressedBy] ?? ""}` : ""}
                  </dd>
                </dl>
              </li>
            ))}
        </Carril>

        <Carril
          id="decision"
          orden={4}
          titulo="Decisión"
          descripcion="Qué elige Claude, y por qué"
          total={decisiones.length}
          activo={carriles >= 4}
        >
          {decisiones.map((c) => (
            <li
              key={`dc-${c.key}`}
              className="tarjeta"
              data-card="decision"
              data-status={c.status}
              data-source={c.source}
              data-entity={c.detection.entityId}
            >
              <span className="titulo">{c.detection.entityId}</span>{" "}
              <span className="etiqueta">
                {c.source === "claude" ? "Claude" : "pregrabada"}
              </span>{" "}
              <span className="etiqueta" data-rule={c.detection.ruleId}>
                {c.detection.ruleId}
              </span>
              {c.status === "pendiente" && (
                <p>{c.source === "claude" ? "Consultando a Claude…" : "Cargando decisión…"}</p>
              )}
              {c.status === "error" && <p data-error="decision">No se pudo decidir: {c.error}</p>}
              {c.decision && (
                <dl>
                  <dt>acción</dt>
                  <dd>{c.decision.actionId}</dd>
                  <dt>motivo</dt>
                  <dd>{c.decision.reason}</dd>
                  <dt>mensaje</dt>
                  <dd>{c.decision.message}</dd>
                </dl>
              )}
            </li>
          ))}
        </Carril>

        <Carril
          id="accion"
          orden={5}
          titulo="Acción"
          descripcion="Lo que efectivamente se ejecutó"
          total={acciones.length}
          activo={carriles >= 5}
        >
          {acciones.map((c) => (
            <li
              key={`ac-${c.key}`}
              className="tarjeta"
              data-card="accion"
              data-status={c.status}
              data-source={c.source}
              data-entity={c.entityId}
            >
              <span className="titulo">{c.actionId}</span>{" "}
              <span className="etiqueta">{c.actionType}</span>{" "}
              <span className="etiqueta">{c.source === "simulada" ? "simulada" : "real"}</span>
              <p>{c.actionDescription}</p>
              <dl>
                <dt>{snapshot?.config.entity.singular ?? "entidad"}</dt>
                <dd>{c.entityId}</dd>
                <dt>resultado</dt>
                <dd>{c.detail ?? "ejecutando…"}</dd>
              </dl>
            </li>
          ))}
        </Carril>
      </div>

      <p className="leyenda">
        Parámetros por URL: <code>?domain=volt|restaurant</code> · <code>&amp;seed=42</code> ·{" "}
        <code>&amp;force=1</code> · <code>&amp;offline=1</code> (todo pregrabado) o{" "}
        <code>&amp;offline=decide</code> (decisiones pregrabadas, acciones reales) ·{" "}
        <code>&amp;max=3</code> · <code>&amp;at=ISO</code>. Con la misma semilla y el mismo{" "}
        <code>at</code>, la corrida es idéntica hasta el timestamp.
      </p>
    </main>
  )
}

function Fila({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function Carril({
  id,
  orden,
  titulo,
  descripcion,
  total,
  activo,
  children,
}: {
  id: string
  orden: number
  titulo: string
  descripcion: string
  total: number
  activo: boolean
  children: ReactNode
}) {
  const vacio = total === 0
  return (
    <section
      className="carril"
      data-lane={id}
      data-order={orden}
      data-active={activo ? "si" : "no"}
      aria-labelledby={`carril-${id}`}
    >
      <header>
        <h2 id={`carril-${id}`}>
          {orden}. {titulo}
        </h2>
        <p className="conteo">
          <span data-count={id}>{total}</span> · {descripcion}
        </p>
      </header>
      {vacio ? (
        <p className="vacio" data-empty={id}>
          {activo ? "Nada acá." : "Esperando…"}
        </p>
      ) : (
        <ol>{children}</ol>
      )}
    </section>
  )
}

async function pedirDecision(
  params: DemoParams,
  detection: Detection,
  config: DomainConfig,
): Promise<{ decision: Decision | null; error: string | null }> {
  if (params.offline !== "off") {
    return { decision: offlineDecision(params.domain, detection, config), error: null }
  }

  try {
    const response = await fetch("/api/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: params.domain, detection }),
    })
    const body = (await response.json()) as { decision?: Decision; error?: string }
    if (!response.ok || !body.decision) {
      return { decision: null, error: body.error ?? `HTTP ${response.status}` }
    }
    return { decision: body.decision, error: null }
  } catch (error) {
    return { decision: null, error: (error as Error).message }
  }
}

async function ejecutar(
  params: DemoParams,
  detection: Detection,
  decision: Decision,
  snap: RunSnapshot,
): Promise<ExecutionResult> {
  // En `offline=full` no sale un solo byte: ni a Claude ni al destino de la
  // acción. Es el modo que sobrevive a una sala sin wifi.
  if (params.offline === "full") {
    return simulatedExecution(findAction(snap.config, decision.actionId))
  }

  try {
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        domain: params.domain,
        actionId: decision.actionId,
        decision,
        detection,
      }),
    })
    const body = (await response.json()) as { result?: ExecutionResult; error?: string }
    if (!response.ok || !body.result) {
      return { ok: false, detail: body.error ?? `HTTP ${response.status}` }
    }
    return body.result
  } catch (error) {
    return { ok: false, detail: (error as Error).message }
  }
}
