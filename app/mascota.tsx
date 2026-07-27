"use client"

import { useEffect, useRef } from "react"

/*
 * La mascota del proyecto: el Reflex Agent, en SVG plano.
 *
 * Recortado en papel y tinta, no en chapa: silueta de tinta llena, huecos de
 * papel, y un solo punto de luz amarillo en la antena — el mismo punto que
 * usa toda la página para decir estado.
 *
 * "Sigue la luz del cursor" se lee acá como una aguada suave que se corre
 * sobre la silueta, la sombra de piso que se desplaza al lado opuesto, y la
 * cabeza y las pupilas que se orientan. Nada de especular ni de relieve.
 *
 * El COMPORTAMIENTO no cambió respecto de la versión anterior: es el mismo
 * lerp de factor fijo por cuadro, sin reloj y sin azar. Lo que cambió es cómo
 * se ve. El refinamiento propio de la mascota queda pendiente (DESIGN.md).
 *
 * No hay 3D. Ver docs/design/referencias/codigo/21st-spline-scene.tsx: la
 * escena de Spline necesita un .splinecode alojado en su nube, que no se
 * genera desde código. El patrón de lazy + Suspense de esa referencia no hace
 * falta porque esto es un SVG inline de ~2 KB, sin dependencias.
 */

export type FaseMascota = "inicio" | "corriendo" | "listo" | "error"

const acotar = (n: number): number => (n < -1 ? -1 : n > 1 ? 1 : n)

/** De dónde viene la luz cuando nadie movió el puntero todavía: arriba y a la izquierda. */
const LUZ_EN_REPOSO = { x: -0.32, y: -0.5 }

interface MascotaProps {
  fase: FaseMascota
  /** Etapa que está mirando el visor, 1–5. Se lee en el pecho del robot. */
  etapa: number
  /** Una línea sobre lo que está haciendo, para la placa del pie. */
  detalle: string
}

export function Mascota({ fase, etapa, detalle }: MascotaProps) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const nodo = ref.current
    if (nodo === null) return

    // `destino` es dónde está la luz; `actual` es dónde la alcanzó el robot.
    // El segundo persigue al primero con un factor fijo por cuadro — sin
    // Date.now() y sin azar, así que el movimiento no depende del reloj.
    const destino = { ...LUZ_EN_REPOSO }
    const actual = { ...LUZ_EN_REPOSO }
    let cuadro = 0

    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)")
    const escribir = () => {
      nodo.style.setProperty("--lx", actual.x.toFixed(3))
      nodo.style.setProperty("--ly", actual.y.toFixed(3))
    }

    const paso = () => {
      // Con movimiento reducido la luz salta al destino: sigue al cursor,
      // pero sin la persecución suavizada.
      const factor = quieto.matches ? 1 : 0.16
      const dx = destino.x - actual.x
      const dy = destino.y - actual.y
      if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) {
        actual.x = destino.x
        actual.y = destino.y
        escribir()
        cuadro = 0
        return
      }
      actual.x += dx * factor
      actual.y += dy * factor
      escribir()
      cuadro = requestAnimationFrame(paso)
    }

    const mover = (evento: PointerEvent) => {
      const caja = nodo.getBoundingClientRect()
      if (caja.width === 0) return
      const cx = caja.left + caja.width / 2
      const cy = caja.top + caja.height / 2
      // El radio de normalización es más grande que el robot para que la luz
      // siga barriendo aunque el puntero pase lejos, por el borde de la página.
      const radio = Math.max(caja.width, 340)
      destino.x = acotar((evento.clientX - cx) / radio)
      destino.y = acotar((evento.clientY - cy) / (radio * 0.75))
      if (cuadro === 0) cuadro = requestAnimationFrame(paso)
    }

    escribir()
    window.addEventListener("pointermove", mover, { passive: true })
    return () => {
      window.removeEventListener("pointermove", mover)
      if (cuadro !== 0) cancelAnimationFrame(cuadro)
    }
  }, [])

  const numero = `0${etapa}`.slice(-2)

  return (
    <figure className="mascota" data-mascota={fase} ref={ref}>
      <svg
        className="mascota-svg"
        viewBox="0 0 240 226"
        role="img"
        aria-labelledby="mascota-titulo mascota-desc"
      >
        <title id="mascota-titulo">El Reflex Agent</title>
        <desc id="mascota-desc">
          Un robot recortado en papel y tinta que gira la cabeza hacia la luz del cursor. En el
          pecho lleva el número de la etapa que estás mirando, y en la antena el punto de luz que
          dice en qué anda.
        </desc>

        <defs>
          {/* La aguada que se corre con la luz. Sin bordes duros no hay mancha. */}
          <radialGradient id="m-lavado-g" cx="0.5" cy="0.5" r="0.5">
            <stop className="m-lavado-centro" offset="0" />
            <stop className="m-lavado-borde" offset="1" />
          </radialGradient>
          <clipPath id="m-clip-cabeza">
            <rect x="52" y="26" width="136" height="68" rx="18" />
          </clipPath>
          <clipPath id="m-clip-cuerpo">
            <rect x="58" y="100" width="124" height="86" rx="16" />
          </clipPath>
        </defs>

        {/* Sombra de piso: papel hundido, plano. Se corre al lado opuesto. */}
        <ellipse className="m-sombra-piso" cx="120" cy="216" rx="78" ry="7" />

        {/* Piernas, pies, brazos y cuello: todo la misma tinta */}
        <g className="m-cuerpo">
          <rect x="80" y="182" width="24" height="20" rx="5" />
          <rect x="136" y="182" width="24" height="20" rx="5" />
          <rect x="70" y="198" width="46" height="13" rx="6" />
          <rect x="124" y="198" width="46" height="13" rx="6" />
          <rect x="42" y="112" width="18" height="58" rx="9" />
          <rect x="180" y="112" width="18" height="58" rx="9" />
          <rect x="106" y="90" width="28" height="14" rx="5" />
        </g>

        {/* Torso: silueta de tinta con la ventanilla de papel en el pecho */}
        <g className="m-torso">
          <rect className="m-cuerpo" x="58" y="100" width="124" height="86" rx="16" />
          <g clipPath="url(#m-clip-cuerpo)">
            <ellipse
              className="m-lavado"
              cx="120"
              cy="143"
              rx="76"
              ry="56"
              fill="url(#m-lavado-g)"
            />
          </g>
          <rect className="m-hueco" x="86" y="118" width="68" height="44" rx="8" />
          <text className="m-numero" x="120" y="147" textAnchor="middle">
            {numero}
          </text>
          <rect className="m-hueco" x="86" y="170" width="68" height="4" rx="2" />
        </g>

        {/* Cabeza: gira un poco hacia la luz */}
        <g className="m-cabeza">
          <rect className="m-cuerpo" x="117.5" y="14" width="5" height="16" rx="2.5" />
          {/* La antena es el punto de luz del robot: el único amarillo acá. */}
          <circle className="m-antena-lente" cx="120" cy="9.5" r="7" />
          <circle className="m-antena-aro" cx="120" cy="9.5" r="7" />

          <g className="m-cuerpo">
            <rect x="42" y="48" width="12" height="24" rx="4" />
            <rect x="186" y="48" width="12" height="24" rx="4" />
            <rect x="52" y="26" width="136" height="68" rx="18" />
          </g>
          <g clipPath="url(#m-clip-cabeza)">
            <ellipse
              className="m-lavado"
              cx="120"
              cy="60"
              rx="82"
              ry="48"
              fill="url(#m-lavado-g)"
            />
          </g>

          {/* Visor: una banda de papel recortada en la tinta */}
          <rect className="m-hueco" x="62" y="38" width="116" height="44" rx="14" />

          <g className="m-ojos">
            <g className="m-pupilas">
              <circle cx="97" cy="60" r="9" />
              <circle cx="143" cy="60" r="9" />
            </g>
            {/* Párpados: bajan cuando el agente todavía no arrancó. Son del
                color del visor, así que "cierran" comiéndose la pupila. */}
            <g className="m-parpados">
              <rect x="85" y="41" width="24" height="17" rx="6" />
              <rect x="131" y="41" width="24" height="17" rx="6" />
            </g>
          </g>
        </g>
      </svg>

      <figcaption className="mascota-pie">
        <span className="mascota-nombre">Reflex Agent</span>
        <span className="mascota-detalle">{detalle}</span>
      </figcaption>
    </figure>
  )
}
