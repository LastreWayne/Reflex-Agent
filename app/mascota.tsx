"use client"

import { useEffect, useRef } from "react"

/*
 * La mascota del proyecto: el Reflex Agent, en SVG plano.
 *
 * "Sigue la luz del cursor" se lee acá como una lámpara de taller que barre
 * chapa pintada, no como un resplandor: el brillo especular se corre sobre la
 * placa, la sombra propia va al lado opuesto, la sombra de piso se alarga, y
 * la cabeza y las pupilas se orientan a la luz. El mundo esmaltado no emite:
 * refleja.
 *
 * No hay 3D. Ver docs/design/referencias/codigo/21st-spline-scene.tsx: la
 * escena de Spline necesita un .splinecode alojado en su nube, que no se
 * genera desde código. El patrón de lazy + Suspense de esa referencia no hace
 * falta porque esto es un SVG inline de ~2 KB, sin dependencias.
 *
 * Sin reloj y sin azar: el seguimiento es un lerp de factor fijo por cuadro.
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
          Un robot de chapa esmaltada que gira la cabeza hacia la luz del cursor. En el pecho
          lleva el número de la etapa que estás mirando.
        </desc>

        <defs>
          <linearGradient id="m-esmalte" x1="0" y1="0" x2="0" y2="1">
            <stop className="m-esmalte-alto" offset="0" />
            <stop className="m-esmalte-bajo" offset="1" />
          </linearGradient>
          <linearGradient id="m-chasis" x1="0" y1="0" x2="0" y2="1">
            <stop className="m-chasis-alto" offset="0" />
            <stop className="m-chasis-bajo" offset="1" />
          </linearGradient>
          <radialGradient id="m-lente" cx="0.36" cy="0.3" r="0.78">
            <stop className="m-lente-centro" offset="0" />
            <stop className="m-lente-medio" offset="0.55" />
            <stop className="m-lente-borde" offset="1" />
          </radialGradient>
          {/* El barrido de la lámpara: reflejo especular con caída suave, y su
              contrario en el lado en sombra. Sin bordes duros no hay mancha. */}
          <radialGradient id="m-barrido" cx="0.5" cy="0.5" r="0.5">
            <stop className="m-barrido-centro" offset="0" />
            <stop className="m-barrido-medio" offset="0.55" />
            <stop className="m-barrido-borde" offset="1" />
          </radialGradient>
          <radialGradient id="m-penumbra" cx="0.5" cy="0.5" r="0.5">
            <stop className="m-penumbra-centro" offset="0" />
            <stop className="m-penumbra-borde" offset="1" />
          </radialGradient>
          <clipPath id="m-clip-cabeza">
            <rect x="52" y="26" width="136" height="68" rx="18" />
          </clipPath>
          <clipPath id="m-clip-cuerpo">
            <rect x="58" y="100" width="124" height="86" rx="16" />
          </clipPath>
        </defs>

        {/* Sombra de piso: se corre al lado opuesto de la luz y se alarga. */}
        <ellipse className="m-sombra-piso" cx="120" cy="216" rx="80" ry="8" />

        {/* Piernas y pies */}
        <g className="m-patas">
          <rect x="80" y="182" width="24" height="20" rx="4" />
          <rect x="136" y="182" width="24" height="20" rx="4" />
          <rect x="70" y="198" width="46" height="13" rx="4" />
          <rect x="124" y="198" width="46" height="13" rx="4" />
        </g>

        {/* Brazos */}
        <g className="m-brazos">
          <rect x="42" y="112" width="18" height="58" rx="9" />
          <rect x="180" y="112" width="18" height="58" rx="9" />
        </g>

        {/* Cuello */}
        <rect className="m-cuello" x="106" y="90" width="28" height="14" rx="4" />

        {/* Torso: la placa esmaltada, con remaches y la ventanilla del pecho */}
        <g className="m-torso">
          <rect
            x="58"
            y="100"
            width="124"
            height="86"
            rx="16"
            fill="url(#m-esmalte)"
            className="m-placa"
          />
          <g clipPath="url(#m-clip-cuerpo)">
            <ellipse
              className="m-sombra-propia"
              cx="120"
              cy="143"
              rx="92"
              ry="66"
              fill="url(#m-penumbra)"
            />
            <ellipse
              className="m-brillo"
              cx="120"
              cy="143"
              rx="76"
              ry="56"
              fill="url(#m-barrido)"
            />
          </g>
          <rect
            x="58.5"
            y="100.5"
            width="123"
            height="85"
            rx="15.5"
            className="m-canto"
            fill="none"
          />
          <g className="m-remaches">
            <circle cx="70" cy="112" r="3" />
            <circle cx="170" cy="112" r="3" />
            <circle cx="70" cy="174" r="3" />
            <circle cx="170" cy="174" r="3" />
          </g>
          <rect className="m-ventana" x="86" y="118" width="68" height="44" rx="7" />
          <text className="m-numero" x="120" y="147" textAnchor="middle">
            {numero}
          </text>
          <rect className="m-franja" x="86" y="168" width="68" height="6" rx="3" />
        </g>

        {/* Cabeza: gira un poco hacia la luz */}
        <g className="m-cabeza">
          <rect className="m-antena-vara" x="117.5" y="14" width="5" height="16" rx="2.5" />
          <g className="m-antena">
            <circle className="m-antena-sombra" cx="120" cy="11" r="8" />
            <circle className="m-antena-lente" cx="120" cy="9.5" r="7.5" fill="url(#m-lente)" />
            <circle className="m-antena-aro" cx="120" cy="9.5" r="7.5" fill="none" />
          </g>

          <rect className="m-oreja" x="42" y="48" width="12" height="24" rx="3" />
          <rect className="m-oreja" x="186" y="48" width="12" height="24" rx="3" />

          <rect
            x="52"
            y="26"
            width="136"
            height="68"
            rx="18"
            fill="url(#m-chasis)"
            className="m-placa"
          />
          <g clipPath="url(#m-clip-cabeza)">
            <ellipse
              className="m-sombra-propia"
              cx="120"
              cy="60"
              rx="98"
              ry="56"
              fill="url(#m-penumbra)"
            />
            <ellipse
              className="m-brillo"
              cx="120"
              cy="60"
              rx="82"
              ry="48"
              fill="url(#m-barrido)"
            />
          </g>
          <rect
            x="52.5"
            y="26.5"
            width="135"
            height="67"
            rx="17.5"
            className="m-canto"
            fill="none"
          />

          <rect className="m-visor" x="62" y="38" width="116" height="44" rx="13" />

          <g className="m-ojos">
            <circle className="m-ojo-lente" cx="97" cy="60" r="13.5" fill="url(#m-lente)" />
            <circle className="m-ojo-aro" cx="97" cy="60" r="13.5" fill="none" />
            <circle className="m-ojo-lente" cx="143" cy="60" r="13.5" fill="url(#m-lente)" />
            <circle className="m-ojo-aro" cx="143" cy="60" r="13.5" fill="none" />
            <g className="m-pupilas">
              <circle cx="97" cy="60" r="5.4" />
              <circle cx="143" cy="60" r="5.4" />
            </g>
            {/* Párpados: bajan cuando el agente todavía no arrancó. */}
            <g className="m-parpados">
              <rect x="83" y="46.5" width="28" height="10" rx="4" />
              <rect x="129" y="46.5" width="28" height="10" rx="4" />
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
