"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { ExecutionResult } from "../adapters/executors/index.js"
import type { Decision, Deliberation, Detection, DomainConfig, Verdict } from "../engine/schema.js"
import { CONFIGS, DOMAIN_IDS } from "./domains.js"
import { Expediente } from "./expediente.js"
import { FondoFlujo } from "./fondo-flujo.js"
import { Mascota, type FaseMascota } from "./mascota.js"
import { PestanasDock } from "./pestanas-dock.js"
import { VidrioLiquido } from "./vidrio-liquido.js"
import {
  buildBallot,
  buildFunnel,
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

/*
 * Pausa entre carriles, para que el pipeline se lea como un pipeline.
 *
 * 350ms era el tiempo de una transición, no el de una lectura: los cinco
 * carriles pasaban en poco más de un segundo y quien miraba veía aparecer
 * datos, no un recorrido. Esta animación es el único momento autoral de la
 * página y lo que explica el producto sin texto — tiene que durar lo que
 * tarda un ojo en registrar cada etapa.
 */
const PASO_MS = 900

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

/*
 * Las cinco etapas, en orden. Fuente única de las pestañas de la portada y de
 * los carriles.
 *
 * `explica` recibe el nombre de la entidad del dominio ("estación", "mesa") en
 * vez de decir "entidad". No es cosmético: cuando el visitante cambia de
 * dominio y las cinco etapas quedan idénticas pero el vocabulario cambia,
 * está VIENDO la tesis del proyecto en lugar de leerla. El motor no se enteró
 * de que cambió el mundo.
 *
 * El texto es para alguien que llegó desde un link a votar, no para quien
 * escribió el motor: nada de "primitivo", "dedup" ni "config".
 */
const ETAPAS = [
  {
    id: "eventos",
    titulo: "Eventos",
    explica: (e: string) =>
      `Cada vez que una ${e} cambia de estado, llega un aviso con la hora. Nada más: nadie dijo todavía que eso importe.`,
  },
  {
    id: "intervalos",
    titulo: "Intervalos",
    explica: (e: string) =>
      `Esos avisos se vuelven tiempo: cuánto lleva cada ${e} en el estado en que está. De acá sale todo lo demás.`,
  },
  {
    id: "detecciones",
    titulo: "Detecciones",
    explica: () =>
      "Las reglas de este dominio miran esas duraciones y marcan lo que se sale de lo normal. Lo que ya se avisó, se calla.",
  },
  {
    id: "decision",
    titulo: "Decisión",
    explica: () =>
      "Claude ve el hallazgo con su evidencia y elige una de las acciones que este dominio permite. Puede elegir no hacer nada.",
  },
  {
    id: "accion",
    titulo: "Acción",
    explica: () =>
      "Se ejecuta lo elegido: un aviso al equipo, un ticket, una notificación al celular. O nada, si eso era lo correcto.",
  },
] as const

interface DecisionCard {
  key: string
  detection: Detection
  status: DecisionStatus
  source: "claude" | "pregrabada"
  verdict: Verdict | null
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

  /** Qué caso muestra el expediente, 0-2. */
  const [casoActivo, setCasoActivo] = useState(0)
  /** Al primer toque en la regleta manda la persona, igual que con las flechas. */
  const [casoDeLaPersona, setCasoDeLaPersona] = useState(false)

  // Los params se leen de la URL recién montado el componente: en el render
  // del servidor no hay `window`, y leerlo antes daría un mismatch.
  useEffect(() => {
    setParams(parseParams(window.location.search))
    setVista(parseView(window.location.search))
  }, [])

  /*
   * Posición del puntero en coordenadas de viewport, para el borde encendido
   * de las tarjetas de decisión y acción.
   *
   * UN listener para toda la página, no uno por tarjeta. La referencia
   * (`references/spotlight-card.tsx`) registra el suyo dentro de cada
   * instancia: con diez tarjetas serían diez listeners haciendo exactamente el
   * mismo cálculo. Las custom properties heredan, así que se escriben una vez
   * en la raíz y todas las tarjetas las leen.
   *
   * Agrupado en rAF: escribir estilo en cada evento de puntero sin agrupar es
   * como se pierden los 60fps que costó conseguir en el campo de flujo.
   */
  useEffect(() => {
    let cuadro = 0
    let x = 0
    let y = 0

    /*
     * POR QUÉ COORDENADAS LOCALES Y NO `background-attachment: fixed`.
     *
     * La referencia posiciona el degradado en coordenadas de viewport y lo
     * fija con `background-attachment: fixed`. Acá eso NO funciona: la tarjeta
     * lleva `backdrop-filter`, y un elemento con filter/backdrop-filter/
     * transform crea un bloque contenedor — `fixed` deja de resolverse contra
     * el viewport y pasa a resolverse contra la tarjeta. Resultado: todas
     * reciben el degradado en la misma posición relativa a sí mismas, se
     * comportan idénticas, y encienden donde el cursor no está.
     *
     * Así que a cada tarjeta se le escribe la posición del cursor RELATIVA A
     * ELLA. Son pocas —sólo decisión y acción llevan borde encendido— y los
     * rects se leen todos juntos antes de escribir ningún estilo, para no
     * alternar lectura y escritura de layout en el mismo cuadro.
     */
    const pintar = () => {
      cuadro = 0
      const tarjetas = document.querySelectorAll<HTMLElement>("[data-borde-vivo]")
      const rects: DOMRect[] = []
      for (const t of tarjetas) rects.push(t.getBoundingClientRect())
      let i = 0
      for (const t of tarjetas) {
        const r = rects[i++]
        if (r === undefined) continue
        t.style.setProperty("--cx", (x - r.left).toFixed(1))
        t.style.setProperty("--cy", (y - r.top).toFixed(1))
      }
    }

    const mover = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      if (cuadro === 0) cuadro = requestAnimationFrame(pintar)
    }

    window.addEventListener("pointermove", mover, { passive: true })
    return () => {
      window.removeEventListener("pointermove", mover)
      if (cuadro !== 0) cancelAnimationFrame(cuadro)
    }
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
    setCasoActivo(0)
    setCasoDeLaPersona(false)

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
      /*
       * Esta pausa faltaba, y es la que hacía que la etapa 4 no existiera.
       * Sin ella el loop arrancaba en el mismo tick: en modo offline
       * `pedirDecision` devuelve al instante porque las decisiones están
       * pregrabadas, así que `setCarriles(5)` disparaba antes de que la 4
       * llegara a pintarse. Y si no hay detecciones en cola, el loop ni corre
       * y el `setCarriles(5)` del final la saltaba del todo.
       */
      await sleep(PASO_MS)
      if (!vivo()) return

      for (const detection of snap.queued) {
        const key = detection.dedupKey
        const source = params.offline === "off" ? "claude" : "pregrabada"

        setDecisiones((prev) => [
          ...prev,
          { key, detection, status: "pendiente", source, verdict: null, error: null },
        ])

        /*
         * Piso de tiempo visible para la tarjeta "pendiente".
         *
         * Con Claude de verdad la espera es de segundos y esto no agrega nada.
         * En offline la decisión ya está escrita y vuelve en el mismo tick: sin
         * este piso, la tarjeta pasa de "pendiente" a "lista" sin que nadie vea
         * que hubo una consulta. Y esa consulta es la parte del pipeline que
         * hay que entender.
         */
        const [{ verdict, error }] = await Promise.all([
          pedirDecision(params, detection, snap.config),
          sleep(PASO_MS),
        ])
        if (!vivo()) return
        setDecisiones((prev) =>
          prev.map((c) =>
            c.key === key ? { ...c, status: verdict ? "lista" : "error", verdict, error } : c,
          ),
        )
        setCarriles(5)

        if (!verdict) {
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

        const action = findAction(snap.config, verdict.decision.actionId)
        setAcciones((prev) => [
          ...prev,
          {
            key,
            entityId: detection.entityId,
            actionId: verdict.decision.actionId,
            actionType: action?.type ?? "desconocida",
            actionDescription: action?.description ?? "La acción elegida no existe en el config.",
            status: "pendiente",
            source: params.offline === "full" ? "simulada" : "real",
            detail: null,
          },
        ])

        /* Mismo piso que la decisión: en modo simulado la ejecución vuelve en
           el mismo tick y la tarjeta nunca se veía "pendiente". */
        const [result] = await Promise.all([
          ejecutar(params, detection, verdict.decision, snap),
          sleep(PASO_MS),
        ])
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

  // El expediente muestra el caso más nuevo hasta que alguien toca la regleta.
  useEffect(() => {
    if (casoDeLaPersona || decisiones.length === 0) return
    setCasoActivo(decisiones.length - 1)
  }, [decisiones.length, casoDeLaPersona])

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
  /*
   * El fallback es la entidad del dominio POR DEFECTO, no la palabra "entidad".
   *
   * `params` se resuelve leyendo la URL en el navegador, así que en el render
   * del servidor es `null`. Con "entidad" como fallback, la primera pintura
   * mostraba la palabra genérica y recién al hidratar aparecía "estación" —
   * un parpadeo justo en el texto cuya gracia es ser específico del dominio.
   * Una URL sin `?domain=` ES volt, así que el servidor puede pintarlo bien.
   */
  const entidad = config ? config.entity.singular : CONFIGS[DOMAIN_IDS[0]].entity.singular

  const acto = etapa >= 3 ? "expediente" : "recorrido"
  const enEscena = decisiones[casoActivo] ?? null
  const accionEnEscena = acciones.find((a) => a.key === enEscena?.key) ?? null

  const casoEnEscena =
    enEscena && snapshot
      ? {
          entityId: enEscena.detection.entityId,
          entityLabel: snapshot.config.entity.singular,
          ruleId: enEscena.detection.ruleId,
          ruleDescription:
            snapshot.classified.find((c) => c.detection === enEscena.detection)
              ?.ruleDescription ?? enEscena.detection.ruleId,
          severidad: SEVERIDAD[enEscena.detection.severity] ?? enEscena.detection.severity,
          evidencia: formatEvidence(enEscena.detection.evidence),
        }
      : null

  const boletaEnEscena = snapshot ? buildBallot(snapshot.config, enEscena?.verdict ?? null) : []

  const consecuenciaEnEscena = accionEnEscena
    ? {
        status: accionEnEscena.status,
        detail: accionEnEscena.detail,
        source: accionEnEscena.source,
      }
    : null

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
        /* Marca las tarjetas que llevan borde encendido: el efecto les escribe
           la posición del cursor relativa a ellas en cada cuadro. */
        data-borde-vivo=""
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
        {c.verdict && (
          <dl>
            <dt>acción</dt>
            <dd>{c.verdict.decision.actionId}</dd>
            <dt>motivo</dt>
            <dd className="dd-texto">{c.verdict.decision.reason}</dd>
            <dt>mensaje</dt>
            <dd className="dd-texto">{c.verdict.decision.message}</dd>
            {/* La vista completa es la técnica: la deliberación se resume en
                una línea. La boleta entera vive en el expediente. */}
            <dt>descartó</dt>
            <dd className="dd-texto">
              {c.verdict.deliberation.rejected.map((r) => r.actionId).join(", ")}
            </dd>
          </dl>
        )}
      </li>
    )),

    acciones.map((c, i) => (
      <li
        key={`ac-${c.key}`}
        className="tarjeta"
        data-card="accion"
        data-borde-vivo=""
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

          {/*
            El marco es una superficie de vidrio líquido de verdad: casi
            transparente, con el filo brillante y el fondo doblándose al
            cruzarlo. Los números —tinte, desenfoque, refracción— no son
            gusto: el tinte es el que sostiene el contraste del texto sobre
            el peor momento del campo. Ver `docs/design/contraste.mjs`.
          */}
          <VidrioLiquido
            clase="hero"
            claseCuerpo="hero-cuerpo"
            /*
              El tinte baja de 0.30 a 0.16 porque el fondo cambió de sentido:
              sobre papel, el vidrio tenía que TAPAR para sostener el texto
              oscuro. Sobre la lámina profunda ACLARA, y el texto claro gana
              contraste cuanto más transparente sea el panel. Es el pedido de
              "mucho más transparente" y el contraste tirando para el mismo
              lado por primera vez.
            */
            tinte={0.16}
            radio="var(--radio-marco)"
            /*
              El desenfoque bajó de 9px a 4px: era él quien borraba la
              estructura que la refracción tiene que doblar. Desplazar un campo
              ya difuminado no se ve. El contraste del texto NO lo sostenía el
              blur sino el tinte, que queda igual.
            */
            desenfoque="4px"
            refraccion={34}
            filo={0.92}
            halo={0.1}
            lustre={0.6}
          >
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

            <h2 id="caminos-titulo" className="rotulo-caminos">
              Los cinco caminos del motor
            </h2>
            <PestanasDock
              etiquetadoPor="caminos-titulo"
              abierta={pestanaAbierta}
              onActivar={tocarPestana}
              caminos={ETAPAS.map((e, i) => ({
                id: e.id,
                titulo: e.titulo,
                texto: e.explica(entidad),
                encendida: carriles > i,
                mirando: vista === "simple" && etapa === i,
                luz: (
                  <Lampara
                    tono={carriles > i ? "naranja" : "apagada"}
                    encendida={carriles > i}
                    className="pestana-lampara"
                  />
                ),
              }))}
            />
          </VidrioLiquido>
        </header>

        {/* La hoja pierde su ancho máximo y sus márgenes en la vista completa:
            ahí los cinco carriles usan la pantalla de borde a borde. */}
        <div className="hoja" data-view={vista}>
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

            {vista === "full" && (
              <button
                type="button"
                className="boton"
                data-action="vista-simple"
                onClick={() => setVista("simple")}
              >
                ← Volver al recorrido
              </button>
            )}
          </div>

          <div className="carriles" data-view={vista} data-sentido={sentido} data-acto={acto}>
            {/* ACTO I — los carriles 1-3, tal como estaban. */}
            {ETAPAS.slice(0, 3).map((e, i) => (
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

            {/* ACTO II — las etapas 4 y 5 comparten escenario. En la vista
                completa siguen siendo dos carriles; el expediente es la forma
                de la vista simple. */}
            {vista === "full" ? (
              ETAPAS.slice(3).map((e, i) => (
                <Carril
                  key={e.id}
                  id={e.id}
                  orden={i + 4}
                  titulo={e.titulo}
                  descripcion={descripciones[i + 3] ?? ""}
                  total={totales[i + 3] ?? 0}
                  activo={carriles >= i + 4}
                  visible
                >
                  {contenidos[i + 3]}
                </Carril>
              ))
            ) : (
              <div className="escenario" data-visible={etapa >= 3 ? "si" : "no"}>
                {snapshot && (
                  <Expediente
                    funnel={buildFunnel(snapshot)}
                    caso={casoEnEscena}
                    ballot={boletaEnEscena}
                    wouldChangeIf={enEscena?.verdict?.deliberation.wouldChangeIf ?? null}
                    error={enEscena?.error ?? null}
                    consecuencia={consecuenciaEnEscena}
                    casos={decisiones.map((d, i) => ({
                      key: d.key,
                      activo: i === casoActivo,
                      onIr: () => {
                        setCasoActivo(i)
                        setCasoDeLaPersona(true)
                      },
                    }))}
                  >
                    {/* ACTO III — recién acá se ofrece la salida. */}
                    {listo && (
                      <button
                        type="button"
                        className="boton boton-epilogo"
                        data-action="vista-completa"
                        onClick={() => setVista("full")}
                      >
                        Ver el recorrido completo →
                      </button>
                    )}
                  </Expediente>
                )}
              </div>
            )}

            <Mascota fase={fase} etapa={vista === "full" ? null : etapa + 1} detalle={detalleMascota} />
          </div>
        </section>

        <footer className="pie" data-view={vista}>
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
): Promise<{ verdict: Verdict | null; error: string | null }> {
  if (params.offline !== "off") {
    return { verdict: offlineDecision(params.domain, detection, config), error: null }
  }

  try {
    const response = await fetch("/api/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: params.domain, detection }),
    })
    const body = (await response.json()) as {
      decision?: Decision
      deliberation?: Deliberation
      error?: string
    }
    if (!response.ok || !body.decision || !body.deliberation) {
      return { verdict: null, error: body.error ?? `HTTP ${response.status}` }
    }
    return {
      verdict: { decision: body.decision, deliberation: body.deliberation },
      error: null,
    }
  } catch (error) {
    return { verdict: null, error: (error as Error).message }
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
