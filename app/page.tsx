"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { ExecutionResult } from "../adapters/executors/index.js"
import type { Decision, Detection, DomainConfig } from "../engine/schema.js"
import { CONFIGS, DOMAIN_IDS } from "./domains.js"
import { FondoFlujo } from "./fondo-flujo.js"
import { Mascota, type FaseMascota } from "./mascota.js"
import {
  buildRun,
  findAction,
  formatClock,
  formatDuration,
  formatEvidence,
  offlineDecision,
  parseParams,
  parseView,
  simulatedExecution,
  toSearchWithView,
  type DemoParams,
  type RunSnapshot,
  type ViewMode,
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

/**
 * Los cinco tonos del punto de luz. La paleta tiene un solo acento, así que
 * los tres tonos de alerta comparten núcleo amarillo y se distinguen por
 * cuánta luz llevan (el grosor del aro): `rojo` es el más cargado, `naranja`
 * el más liviano. `claro` es el punto de tinta de "todo bien, sin alerta" —
 * el verde no existe acá. El vocabulario de `data-lamp` no cambió a propósito.
 */
type Tono = "rojo" | "ambar" | "naranja" | "claro" | "apagada"

/**
 * De qué color prende la lámpara según el estado de la entidad. Los estados
 * son de dominio (`configs/*.json`), así que el mapa cubre los dos y cae en
 * `claro` para cualquier estado nuevo.
 */
const TONO_ESTADO: Record<string, Tono> = {
  Faulted: "rojo",
  Unavailable: "rojo",
  Charging: "ambar",
  Occupied: "ambar",
  Reserved: "ambar",
  Ocupada: "ambar",
  Reservada: "ambar",
  Available: "claro",
  Libre: "claro",
}

const TONO_SEVERIDAD: Record<string, Tono> = { high: "rojo", medium: "ambar", low: "claro" }

/** Las cinco etapas, en orden. Es la fuente única de las tarjetas de la portada y de los carriles. */
const ETAPAS = [
  {
    id: "eventos",
    titulo: "Eventos",
    explica:
      "Llega un cambio de estado por entidad, crudo y con su hora. Todavía nadie interpreta nada.",
  },
  {
    id: "intervalos",
    titulo: "Intervalos",
    explica:
      "Los eventos se vuelven tramos con duración. Es el primitivo del motor: cuánto llevó cada estado.",
  },
  {
    id: "detecciones",
    titulo: "Detecciones",
    explica:
      "Las reglas del dominio leen los tramos. Lo que ya se avisó se silencia por dedup y cooldown.",
  },
  {
    id: "decision",
    titulo: "Decisión",
    explica: "Claude recibe la detección con su evidencia y elige una acción del config, no del código.",
  },
  {
    id: "accion",
    titulo: "Acción",
    explica:
      "La acción elegida se ejecuta: aviso al equipo de guardia, ticket, notificación al celular, o ninguna.",
  },
] as const

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

  /** Vista simple (un carril grande) o completa (los cinco en grilla). */
  const [vista, setVista] = useState<ViewMode>("simple")
  /** Qué etapa muestra el visor de la vista simple, 0–4. */
  const [etapa, setEtapa] = useState(0)
  /** Hacia dónde se movió la última vez, para que el carril entre por ese lado. */
  const [sentido, setSentido] = useState<"adelante" | "atras">("adelante")
  /**
   * Mientras nadie tocó las flechas, el visor sigue solo al pipeline: es la
   * única animación autoral de la página. Al primer ← / → manda la persona.
   */
  const [conduceLaPersona, setConduceLaPersona] = useState(false)
  const [controlesAbiertos, setControlesAbiertos] = useState(false)
  /** Qué pestaña abrió un TOQUE. El puntero y el teclado los resuelve el CSS. */
  const [pestanaAbierta, setPestanaAbierta] = useState<string | null>(null)

  // Los params se leen de la URL recién montado el componente: en el render
  // del servidor no hay `window`, y leerlo antes daría un mismatch.
  useEffect(() => {
    setParams(parseParams(window.location.search))
    setVista(parseView(window.location.search))
  }, [])

  const corridaRef = useRef(0)
  const ultimaRef = useRef<DemoParams | null>(null)
  // La vista no entra en las deps del efecto del pipeline: cambiarla no debe
  // re-correr el motor ni volver a pagarle a Claude. Pero el `replaceState`
  // que hace el efecto sí tiene que conservarla, así que la lee de un ref.
  const vistaRef = useRef<ViewMode>(vista)
  vistaRef.current = vista

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

    window.history.replaceState(null, "", toSearchWithView(params, vistaRef.current))
    setSnapshot(null)
    setCarriles(0)
    setDecisiones([])
    setAcciones([])
    setFallo(null)
    setEtapa(0)
    setSentido("adelante")
    setConduceLaPersona(false)

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

  // El visor persigue al pipeline hasta que alguien toca las flechas.
  useEffect(() => {
    if (conduceLaPersona || carriles === 0) return
    setSentido("adelante")
    setEtapa(carriles - 1)
  }, [carriles, conduceLaPersona])

  // La vista viaja en la URL para que el link se pueda compartir tal cual se ve.
  useEffect(() => {
    if (params === null) return
    window.history.replaceState(null, "", toSearchWithView(params, vista))
  }, [params, vista])

  const cambiar = (patch: Partial<DemoParams>) => {
    setParams((prev) => (prev === null ? prev : { ...prev, ...patch }))
  }

  const irAEtapa = (proxima: number, deLaPersona: boolean) => {
    const destino = proxima < 0 ? 0 : proxima > ETAPAS.length - 1 ? ETAPAS.length - 1 : proxima
    setSentido(destino >= etapa ? "adelante" : "atras")
    setEtapa(destino)
    if (deLaPersona) setConduceLaPersona(true)
  }

  /**
   * Tocar una pestaña lleva el visor a esa etapa y baja hasta el motor: el
   * primer frame no muestra carriles, así que el salto es parte de lo que
   * hace la pestaña.
   */
  const verEtapa = (indice: number) => {
    setVista("simple")
    irAEtapa(indice, true)
    document.getElementById("escena")?.scrollIntoView({ block: "start" })
  }

  /**
   * Una pestaña se abre con el puntero (`:hover`) y con el teclado
   * (`:focus-visible`) desde el CSS. Este handler cubre el tercer caso: en un
   * dispositivo SIN hover, el primer toque la abre para poder leerla y el
   * segundo lleva a la etapa. Sin esto, en un teléfono el texto de la pestaña
   * sería invisible — un disclosure sólo-hover no lo puede usar nadie que no
   * tenga mouse.
   *
   * `matchMedia` se consulta dentro del evento, nunca durante el render: si se
   * leyera al renderizar, el servidor y el navegador no coincidirían.
   */
  const tocarPestana = (id: string, indice: number) => {
    if (!window.matchMedia("(hover: hover)").matches && pestanaAbierta !== id) {
      setPestanaAbierta(id)
      return
    }
    setPestanaAbierta(null)
    verEtapa(indice)
  }

  const config: DomainConfig | null = params ? CONFIGS[params.domain] : null
  const listo = carriles >= 5 && decisiones.every((d) => d.status !== "pendiente")
  const decididas = decisiones.filter((d) => d.status !== "pendiente").length
  const entidad = config ? config.entity.singular : "entidad"

  const fase: FaseMascota = fallo
    ? "error"
    : listo
      ? "listo"
      : snapshot
        ? "corriendo"
        : "inicio"

  const detalleMascota = fallo
    ? "El motor se cortó. Mirá la banda de estado."
    : !snapshot
      ? "Esperando la corrida."
      : listo
        ? `Corrida completa: ${ETAPAS.length} etapas, ${acciones.length} acciones.`
        : `Recorriendo el pipeline: etapa ${carriles === 0 ? 1 : carriles} de ${ETAPAS.length}.`

  const totales = [
    snapshot && carriles >= 1 ? snapshot.events.length : 0,
    snapshot && carriles >= 2 ? snapshot.intervals.length : 0,
    snapshot && carriles >= 3 ? snapshot.classified.length : 0,
    decisiones.length,
    acciones.length,
  ]

  const contenidos: ReactNode[] = [
    snapshot &&
      carriles >= 1 &&
      snapshot.events.map((e, i) => (
        <li
          key={`ev-${i}`}
          className="tarjeta"
          data-card="evento"
          data-entity={e.entityId}
          data-state={e.state}
          style={{ "--i": i % 12 } as CSSProperties}
        >
          <p className="tarjeta-cabeza">
            <Lampara tono={TONO_ESTADO[e.state] ?? "claro"} />
            <span className="titulo">{e.entityId}</span>{" "}
            <span className="etiqueta">{e.state}</span>{" "}
            <time className="tarjeta-hora" dateTime={e.timestamp}>
              {formatClock(e.timestamp)}
            </time>
          </p>
        </li>
      )),

    snapshot &&
      carriles >= 2 &&
      snapshot.intervals.map((iv, i) => (
        <li
          key={`iv-${i}`}
          className="tarjeta"
          data-card="intervalo"
          data-entity={iv.entityId}
          data-state={iv.state}
          data-open={iv.isOpen ? "si" : "no"}
          style={{ "--i": i % 12 } as CSSProperties}
        >
          <p className="tarjeta-cabeza">
            <Lampara tono={TONO_ESTADO[iv.state] ?? "claro"} />
            <span className="titulo">{iv.entityId}</span>{" "}
            <span className="etiqueta">{iv.state}</span>
            {iv.isOpen && <span className="sello">en curso</span>}
          </p>
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
      )),

    snapshot &&
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
          style={{ "--i": i % 12 } as CSSProperties}
        >
          <p className="tarjeta-cabeza">
            <Lampara
              tono={TONO_SEVERIDAD[c.detection.severity] ?? "claro"}
              encendida={c.status === "pasa"}
            />
            <span className="titulo">{c.detection.ruleId}</span>{" "}
            <span className="etiqueta" data-severity={c.detection.severity}>
              severidad {SEVERIDAD[c.detection.severity] ?? c.detection.severity}
            </span>
          </p>
          <p className="tarjeta-texto">{c.ruleDescription}</p>
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
      )),

    decisiones.map((c, i) => (
      <li
        key={`dc-${c.key}`}
        className="tarjeta"
        data-card="decision"
        data-status={c.status}
        data-source={c.source}
        data-entity={c.detection.entityId}
        style={{ "--i": i % 12 } as CSSProperties}
      >
        <p className="tarjeta-cabeza">
          <Lampara
            tono={c.status === "error" ? "rojo" : c.status === "lista" ? "claro" : "ambar"}
            latiendo={c.status === "pendiente"}
          />
          <span className="titulo">{c.detection.entityId}</span>{" "}
          <span className="etiqueta" data-tag="fuente">
            {c.source === "claude" ? "Claude" : "pregrabada"}
          </span>{" "}
          <span className="etiqueta" data-rule={c.detection.ruleId}>
            {c.detection.ruleId}
          </span>
        </p>
        {c.status === "pendiente" && (
          <p className="tarjeta-texto">
            {c.source === "claude" ? "Consultando a Claude…" : "Cargando decisión…"}
          </p>
        )}
        {c.status === "error" && (
          <p className="tarjeta-texto aviso" data-error="decision">
            No se pudo decidir: {c.error}
          </p>
        )}
        {c.decision && (
          <dl>
            <dt>acción</dt>
            <dd>{c.decision.actionId}</dd>
            <dt>motivo</dt>
            <dd className="dd-texto">{c.decision.reason}</dd>
            <dt>mensaje</dt>
            <dd className="dd-texto">{c.decision.message}</dd>
          </dl>
        )}
      </li>
    )),

    acciones.map((c, i) => (
      <li
        key={`ac-${c.key}`}
        className="tarjeta"
        data-card="accion"
        data-status={c.status}
        data-source={c.source}
        data-entity={c.entityId}
        style={{ "--i": i % 12 } as CSSProperties}
      >
        <p className="tarjeta-cabeza">
          <Lampara
            tono={
              c.status === "fallo"
                ? "rojo"
                : c.status === "ok"
                  ? "claro"
                  : c.status === "omitida"
                    ? "apagada"
                    : "ambar"
            }
            encendida={c.status !== "omitida"}
            latiendo={c.status === "pendiente"}
          />
          <span className="titulo">{c.actionId}</span>{" "}
          <span className="etiqueta">{c.actionType}</span>{" "}
          <span className="etiqueta" data-tag="fuente">
            {c.source === "simulada" ? "simulada" : "real"}
          </span>
        </p>
        <p className="tarjeta-texto">{c.actionDescription}</p>
        <dl>
          <dt>{snapshot?.config.entity.singular ?? "entidad"}</dt>
          <dd>{c.entityId}</dd>
          <dt>resultado</dt>
          <dd className="dd-texto">{c.detail ?? "ejecutando…"}</dd>
        </dl>
      </li>
    )),
  ]

  const descripciones = [
    `Lo que reporta cada ${entidad}`,
    "Cuánto duró cada estado",
    "Reglas que dispararon, y cuáles se silenciaron",
    "Qué elige Claude, y por qué",
    "Lo que efectivamente se ejecutó",
  ]

  const etapaActual = ETAPAS[etapa] ?? ETAPAS[0]

  return (
    <>
      <a className="saltar" href="#escena">
        Saltar al pipeline
      </a>

      <main>
        {/* ── PRIMER FRAME ─────────────────────────────────────────────
            Un marco de vidrio embutido sobre las líneas de flujo, con el
            título adentro y las cinco pestañas mínimas abajo. Nada más
            entra acá: ni controles, ni carriles, ni mascota. Ver DESIGN.md. */}
        <header className="portada">
          {/* Ver app/fondo-flujo.tsx: el fondo es un archivo aparte a propósito. */}
          <FondoFlujo />

          <div className="hero">
            <div className="hero-centro">
              <div className="hero-titulo">
                <h1 className="titular">
                  <span className="titular-nombre">
                    <span>Reflex </span>
                    <span>Agent</span>
                  </span>
                  <span className="titular-lema">el mismo motor, dos dominios</span>
                </h1>
                <p className="portada-bajada">
                  El simulador, los intervalos, las reglas y la supresión corren en tu navegador.
                  Sólo la decisión de Claude y la ejecución de la acción pasan por el servidor.
                </p>
              </div>
            </div>

            <h2 id="caminos-titulo" className="rotulo-seccion">
              Los cinco caminos del motor
            </h2>
            <ol className="pestanas" aria-labelledby="caminos-titulo">
              {ETAPAS.map((e, i) => (
                <li
                  key={e.id}
                  className="pestana"
                  data-stage={e.id}
                  data-encendida={carriles > i ? "si" : "no"}
                  data-mirando={vista === "simple" && etapa === i ? "si" : "no"}
                  data-abierta={pestanaAbierta === e.id ? "si" : "no"}
                >
                  <button
                    type="button"
                    className="pestana-boton"
                    data-action={`camino-${e.id}`}
                    aria-current={vista === "simple" && etapa === i ? "step" : undefined}
                    onClick={() => tocarPestana(e.id, i)}
                  >
                    <span className="pestana-cima">
                      <span className="pestana-orden" aria-hidden="true">{`0${i + 1}`}</span>
                      <span className="pestana-titulo">{e.titulo}</span>
                      <Lampara
                        tono={carriles > i ? "naranja" : "apagada"}
                        encendida={carriles > i}
                        className="pestana-lampara"
                      />
                    </span>
                    <span className="pestana-caja">
                      <span className="pestana-panel">
                        <span className="pestana-texto">{e.explica}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </header>

        <div className="hoja">
        {/* ── EL MOTOR ─────────────────────────────────────────────────── */}
        <section className="escena" id="escena" data-view={vista} aria-labelledby="escena-titulo">
          <div className="escena-cabeza">
            <h2 id="escena-titulo" className="titulo-seccion">
              El motor, corriendo
            </h2>

            <p
              className="estado-corrida"
              data-fase={listo ? "listo" : snapshot ? "corriendo" : "inicio"}
            >
              {fallo ? (
                <strong data-error="motor">{fallo}</strong>
              ) : !params || !snapshot || !config ? (
                "Preparando la corrida…"
              ) : (
                <>
                  <strong>{config.displayName}</strong> <span className="punto">·</span> semilla{" "}
                  <span className="cifra">{params.seed}</span> <span className="punto">·</span>{" "}
                  <span className="cifra">{snapshot.events.length}</span> eventos sobre{" "}
                  {config.entity.plural} <span className="punto">·</span> ventana{" "}
                  <time dateTime={snapshot.from.toISOString()}>
                    {formatClock(snapshot.from.toISOString())}
                  </time>
                  –
                  <time dateTime={snapshot.now.toISOString()}>
                    {formatClock(snapshot.now.toISOString())}
                  </time>{" "}
                  UTC <span className="punto">·</span>{" "}
                  <span data-modo={params.offline}>
                    {params.offline === "off"
                      ? "en vivo (Claude decide)"
                      : params.offline === "decide"
                        ? "offline: decisiones pregrabadas, acciones reales"
                        : "offline: decisiones pregrabadas, acciones simuladas"}
                  </span>
                  {params.forceIncident && (
                    <span className="pildora" data-modo="forzado">
                      incidente forzado
                    </span>
                  )}{" "}
                  <span className="punto">·</span>{" "}
                  {listo ? "listo" : `decidiendo ${decididas}/${snapshot.queued.length}`}
                </>
              )}
            </p>
          </div>

          <div className="banda">
            {params && (
              <div className="consola" data-abierta={controlesAbiertos ? "si" : "no"}>
                <button
                  type="button"
                  className="consola-lengueta"
                  data-action="controles"
                  aria-expanded={controlesAbiertos}
                  aria-controls="consola-panel"
                  onClick={() => setControlesAbiertos((v) => !v)}
                >
                  <span className="consola-titulo">Controles</span>
                  <span className="consola-resumen">
                    {CONFIGS[params.domain].displayName} · semilla {params.seed}
                    {params.forceIncident ? " · forzado" : ""}
                    {params.offline === "off" ? "" : " · offline"}
                  </span>
                  <span className="consola-signo" aria-hidden="true">
                    {controlesAbiertos ? "Cerrar" : "Abrir"}
                  </span>
                </button>

                <div className="consola-caja">
                  <div className="consola-panel" id="consola-panel" inert={!controlesAbiertos}>
                    <div className="controles">
                      <fieldset className="grupo">
                        <legend>Dominio</legend>
                        <div className="grupo-cuerpo">
                          {DOMAIN_IDS.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className="boton"
                              data-action={`dominio-${id}`}
                              aria-pressed={params.domain === id}
                              onClick={() => cambiar({ domain: id, forceIncident: false })}
                            >
                              {CONFIGS[id].displayName}
                            </button>
                          ))}
                        </div>
                      </fieldset>

                      <fieldset className="grupo">
                        <legend>
                          <label htmlFor="seed">Semilla</label>
                        </legend>
                        <div className="grupo-cuerpo">
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
                        </div>
                      </fieldset>

                      <fieldset className="grupo">
                        <legend>Corrida</legend>
                        <div className="grupo-cuerpo">
                          <button
                            type="button"
                            className="boton"
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
                            className="boton"
                            data-action="reiniciar"
                            onClick={() => cambiar({ forceIncident: false })}
                          >
                            Reiniciar
                          </button>
                        </div>
                      </fieldset>

                      <fieldset className="grupo">
                        <legend>
                          <label htmlFor="offline">Modo offline</label>
                        </legend>
                        <div className="grupo-cuerpo">
                          <label className="interruptor" htmlFor="offline">
                            <input
                              id="offline"
                              type="checkbox"
                              data-action="offline"
                              checked={params.offline !== "off"}
                              onChange={(e) =>
                                cambiar({ offline: e.target.checked ? "full" : "off" })
                              }
                            />
                            <span className="interruptor-cuerpo" aria-hidden="true">
                              <span className="interruptor-punto" />
                            </span>
                            <span className="interruptor-texto">
                              {params.offline === "off" ? "Apagado" : "Encendido"}
                            </span>
                          </label>
                        </div>
                      </fieldset>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mando">
            <div className="visor-mando" data-oculto={vista === "full" ? "si" : "no"}>
              <button
                type="button"
                className="paso"
                data-action="etapa-anterior"
                onClick={() => irAEtapa(etapa - 1, true)}
                disabled={etapa === 0}
                aria-label="Etapa anterior"
              >
                <span aria-hidden="true">←</span>
              </button>
              <p className="visor-posicion">
                <span className="visor-etapa">{etapaActual.titulo}</span>
                <span className="visor-cuenta">
                  <span className="cifra">{etapa + 1}</span> de{" "}
                  <span className="cifra">{ETAPAS.length}</span>
                </span>
              </p>
              <button
                type="button"
                className="paso"
                data-action="etapa-siguiente"
                onClick={() => irAEtapa(etapa + 1, true)}
                disabled={etapa === ETAPAS.length - 1}
                aria-label="Etapa siguiente"
              >
                <span aria-hidden="true">→</span>
              </button>
            </div>

            <div className="selector-vista" role="group" aria-label="Vista del pipeline">
              <span className="selector-rotulo" aria-hidden="true">
                Vista
              </span>
              <button
                type="button"
                className="boton"
                data-action="vista-simple"
                aria-pressed={vista === "simple"}
                onClick={() => setVista("simple")}
              >
                Un carril
              </button>
              <button
                type="button"
                className="boton"
                data-action="vista-completa"
                aria-pressed={vista === "full"}
                onClick={() => setVista("full")}
              >
                Los cinco
              </button>
            </div>
          </div>

          <div className="carriles" data-view={vista} data-sentido={sentido}>
            {ETAPAS.map((e, i) => (
              <Carril
                key={e.id}
                id={e.id}
                orden={i + 1}
                titulo={e.titulo}
                descripcion={descripciones[i] ?? ""}
                total={totales[i] ?? 0}
                activo={carriles >= i + 1}
                visible={vista === "full" || etapa === i}
              >
                {contenidos[i]}
              </Carril>
            ))}
          </div>

          {vista === "simple" && (
            <Mascota fase={fase} etapa={etapa + 1} detalle={detalleMascota} />
          )}
        </section>

        <footer className="pie">
          <p className="leyenda">
            Parámetros por URL: <code>?domain=volt|restaurant</code> · <code>&amp;seed=42</code> ·{" "}
            <code>&amp;force=1</code> · <code>&amp;offline=1</code> (todo pregrabado) o{" "}
            <code>&amp;offline=decide</code> (decisiones pregrabadas, acciones reales) ·{" "}
            <code>&amp;max=3</code> · <code>&amp;at=ISO</code> · <code>&amp;view=full</code> (los
            cinco carriles). Con la misma semilla y el mismo <code>at</code>, la corrida es
            idéntica hasta el timestamp.
          </p>
        </footer>
        </div>
      </main>
    </>
  )
}

/**
 * Un punto de luz: núcleo y aro, nada más. Es como se dice la severidad y el
 * estado en toda la página — nunca con un borde de color al costado de una
 * tarjeta. Sobre papel el amarillo solo no llega a 3:1, así que el aro
 * (`--punto-aro`) es el que carga el contraste; el CSS lo resuelve.
 */
function Lampara({
  tono,
  encendida = true,
  latiendo = false,
  className,
}: {
  tono: Tono
  encendida?: boolean
  latiendo?: boolean
  className?: string
}) {
  return (
    <span
      className={className ? `lampara ${className}` : "lampara"}
      data-lamp={tono}
      data-lit={encendida ? "si" : "no"}
      data-beat={latiendo ? "si" : "no"}
      aria-hidden="true"
    />
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
  visible,
  children,
}: {
  id: string
  orden: number
  titulo: string
  descripcion: string
  total: number
  activo: boolean
  visible: boolean
  children: ReactNode
}) {
  const vacio = total === 0
  return (
    <section
      className="carril"
      data-lane={id}
      data-order={orden}
      data-active={activo ? "si" : "no"}
      data-visible={visible ? "si" : "no"}
      aria-labelledby={`carril-${id}`}
    >
      <header className="carril-cabeza">
        <span className="carril-orden" aria-hidden="true">{`0${orden}`}</span>
        <div className="carril-rotulo">
          <h2 id={`carril-${id}`}>{titulo}</h2>
          <p className="conteo">
            <span className="cifra" data-count={id}>
              {total}
            </span>{" "}
            · {descripcion}
          </p>
        </div>
        <Lampara
          tono={activo ? "naranja" : "apagada"}
          encendida={activo}
          className="carril-piloto"
        />
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
