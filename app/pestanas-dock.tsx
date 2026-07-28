"use client"

/*
 * LAS CINCO PESTAÑAS, con magnificación de dock.
 *
 * Adaptado de `references/dock-magnify.tsx`. Lo que se toma es EL CARÁCTER:
 * el ancho de cada ítem responde a la DISTANCIA del cursor, así que el vecino
 * crece un poco y el siguiente menos. No es un hover binario — ahí está toda
 * la gracia del dock de macOS, y es lo que pidió el humano.
 *
 * SIN framer-motion. El efecto necesita JS —hay que saber dónde está el
 * cursor respecto de cada ítem— pero son quince líneas:
 *
 *   1. un `pointermove` sobre la tira, `{ passive: true }`
 *   2. por ítem: `dist = |cursorX − centroDelÍtem|`
 *   3. se escribe `--cerca` en el ítem, de 1 (encima) a 0 (fuera del alcance)
 *   4. el CSS hace el ancho con un `calc()` y una transición corta
 *
 * Todo agrupado en un `requestAnimationFrame`, y con las lecturas de layout
 * separadas de las escrituras: escribir estilos por ítem en cada evento crudo
 * de mouse es exactamente cómo se pierden los 60 fps que ya costó conseguir.
 *
 * Lo único que se pierde sin librería de springs es el REBOTE al asentarse.
 * Se aproxima con `--rebote`, una cubic-bezier con overshoot.
 *
 * ── ACCESIBILIDAD ─────────────────────────────────────────────────────────
 *
 * El dock original expande sólo con hover de mouse. Acá no alcanza:
 *
 *   · El LARGO EN REPOSO lo decide el CSS, no este JS. Sin puntero fino las
 *     pestañas arrancan enteras, y con `prefers-reduced-motion` también. Este
 *     efecto es una gracia de puntero: sin puntero no hay nada que magnificar,
 *     y una pestaña recortada que nadie puede agrandar es una pestaña rota.
 *   · Abrir el panel es `:hover`, `:focus-visible` Y `data-abierta` (toque).
 *     Las tres entradas comparten estado visual.
 *   · Sin JS, o antes de la hidratación, la pestaña sigue abriéndose por
 *     hover y por foco: se pierde la proximidad, no el acceso.
 */

import { useEffect, useRef, type ReactNode } from "react"
import { useVidrio } from "./vidrio-liquido.js"

export interface CaminoPestana {
  id: string
  titulo: string
  /** Lo que se lee cuando la pestaña se abre. */
  texto: string
  /** Esta etapa ya se encendió en la corrida. */
  encendida?: boolean
  /** El visor está mostrando esta etapa ahora. */
  mirando?: boolean
  /** Punto de luz opcional, a la derecha del título. */
  luz?: ReactNode
}

export interface PestanasDockProps {
  caminos: CaminoPestana[]
  /**
   * Cuál abrió un TOQUE. El puntero y el teclado los resuelve el CSS; esto
   * cubre el tercer caso, el de las pantallas sin hover.
   */
  abierta?: string | null
  onActivar: (id: string, indice: number) => void
  /** `id` del título que rotula la tira. */
  etiquetadoPor?: string
  /**
   * Radio de influencia del cursor, en px. Fuera de él, `--cerca` es 0.
   *
   * Tiene que abarcar DOS pestañas para que la caída se lea: con el alcance
   * apenas más grande que una, el vecino crece veinte píxeles y el siguiente
   * nada, y el efecto se lee como un hover con retardo en vez de como un
   * dock. 360 px cubre la de al lado y roza a la siguiente.
   */
  alcance?: number
  /** Prefijo del `data-action` de cada botón. */
  accion?: string
}

export function PestanasDock({
  caminos,
  abierta = null,
  onActivar,
  etiquetadoPor,
  alcance = 360,
  accion = "camino",
}: PestanasDockProps) {
  const tiraRef = useRef<HTMLOListElement>(null)

  // Las cinco comparten vidrio: una sola llamada, un solo juego de opciones.
  // Sin refracción — sobre un tinte tan denso no se vería, y son cinco
  // superficies chicas que no vale la pena filtrar. Ver vidrio-liquido.tsx.
  const { vidrio, capas } = useVidrio({
    clase: "pestana-boton",
    tinte: 0.88,
    radio: "var(--radio-pestana)",
    desenfoque: "13px",
    saturacion: 1.15,
    filo: 0.85,
    halo: 0.09,
    lustre: 0.5,
  })

  useEffect(() => {
    const tira = tiraRef.current
    if (tira === null) return
    // Sin puntero fino no hay proximidad que calcular, y con movimiento
    // reducido las pestañas ya están enteras: en los dos casos el CSS manda
    // y este efecto no tiene nada que hacer.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let pedido = 0
    let x = Number.NaN

    const pintar = () => {
      pedido = 0
      const botones = tira.querySelectorAll<HTMLElement>(".pestana-boton")
      // Primero se LEE todo, después se ESCRIBE todo. Intercalar las dos cosas
      // dentro del bucle fuerza un recálculo de layout por ítem en cada cuadro.
      const centros: number[] = []
      for (const boton of botones) {
        const caja = boton.getBoundingClientRect()
        centros.push(caja.left + caja.width / 2)
      }
      let i = 0
      for (const boton of botones) {
        const distancia = Math.abs(x - (centros[i] ?? 0))
        const crudo = Number.isNaN(x) ? 0 : Math.max(0, 1 - distancia / alcance)
        // Suavizado de Hermite. Una rampa lineal se lee como un escalón; con
        // la ese, el de al lado crece bastante y el siguiente bastante menos,
        // que es la caída que hace al dock parecerse a un dock.
        boton.style.setProperty("--cerca", (crudo * crudo * (3 - 2 * crudo)).toFixed(3))
        i += 1
      }
    }

    const encuadrar = () => {
      if (pedido === 0) pedido = requestAnimationFrame(pintar)
    }
    const mover = (evento: PointerEvent) => {
      x = evento.clientX
      encuadrar()
    }
    const salir = () => {
      x = Number.NaN
      encuadrar()
    }

    tira.addEventListener("pointermove", mover, { passive: true })
    tira.addEventListener("pointerleave", salir, { passive: true })
    return () => {
      tira.removeEventListener("pointermove", mover)
      tira.removeEventListener("pointerleave", salir)
      if (pedido !== 0) cancelAnimationFrame(pedido)
    }
  }, [alcance])

  return (
    <ol className="pestanas" ref={tiraRef} aria-labelledby={etiquetadoPor}>
      {caminos.map((camino, i) => (
        <li
          key={camino.id}
          className="pestana"
          data-stage={camino.id}
          data-encendida={camino.encendida ? "si" : "no"}
          data-mirando={camino.mirando ? "si" : "no"}
          data-abierta={abierta === camino.id ? "si" : "no"}
        >
          <button
            {...vidrio}
            type="button"
            data-action={`${accion}-${camino.id}`}
            aria-current={camino.mirando ? "step" : undefined}
            onClick={() => onActivar(camino.id, i)}
          >
            {capas}
            <span className="pestana-cima">
              <span className="pestana-orden" aria-hidden="true">{`0${i + 1}`}</span>
              <span className="pestana-titulo">{camino.titulo}</span>
              {camino.luz}
            </span>
            <span className="pestana-caja">
              <span className="pestana-panel">
                <span className="pestana-texto">{camino.texto}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}
