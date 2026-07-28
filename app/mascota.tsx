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
  /**
   * Etapa que está mirando el visor, 1–5. Se lee en el pecho del robot.
   *
   * `null` cuando NO hay una etapa en foco — la vista de los cinco carriles,
   * donde se ven todos a la vez. Es `null` y no un booleano `mostrarNumero`
   * porque eso es lo que pasa de verdad: no es que el número esté escondido,
   * es que ahí no existe una etapa que mostrar.
   */
  etapa: number | null
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

  const numero = etapa === null ? null : `0${etapa}`.slice(-2)

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
          Un centinela recortado en papel y tinta. Un visor ancho barre de lado a lado siguiendo la
          luz del cursor
          {numero !== null && "; en el pecho lleva el número de la etapa que estás mirando"}, y
          arriba el punto de luz que dice en qué anda.
        </desc>

        <defs>
          {/* La aguada que se corre con la luz. Sin bordes duros no hay mancha. */}
          <radialGradient id="m-lavado-g" cx="0.5" cy="0.5" r="0.5">
            <stop className="m-lavado-centro" offset="0" />
            <stop className="m-lavado-borde" offset="1" />
          </radialGradient>
          <clipPath id="m-clip-cabeza">
            <path d="M46 30 L194 30 L206 74 L184 96 L56 96 L34 74 Z" />
          </clipPath>
          <clipPath id="m-clip-cuerpo">
            <path d="M74 106 L166 106 L182 150 L162 194 L78 194 L58 150 Z" />
          </clipPath>
          {/* La ranura del visor recorta el barrido: la línea no puede salirse
              de la mirada, igual que en un sensor de verdad. */}
          <clipPath id="m-clip-visor">
            <path d="M52 46 L188 46 L196 72 L178 84 L62 84 L44 72 Z" />
          </clipPath>
        </defs>

        {/* Sombra de piso: papel hundido, plano. Se corre al lado opuesto. */}
        <ellipse className="m-sombra-piso" cx="120" cy="214" rx="70" ry="6" />

        {/*
          NADA DE BRAZOS, PIERNAS NI PIES.
          La versión anterior los tenía y era eso lo que la volvía un juguete:
          un centinela imponente no se para en piecitos. Ahora la silueta es
          una cuña que se planta — ancha arriba, angosta abajo — y los hombros
          van barridos hacia atrás, que es la forma que lee como velocidad.
        */}
        <g className="m-cuerpo">
          {/* Hombreras barridas: el ángulo hacia atrás es la lectura de rapidez. */}
          <path d="M56 108 L82 104 L74 148 L44 138 Z" />
          <path d="M184 108 L158 104 L166 148 L196 138 Z" />
          {/* La base: se ensancha al apoyar, sin pies. */}
          <path d="M84 192 L156 192 L168 208 L72 208 Z" />
        </g>

        {/* Torso: cuña de tinta con la ventanilla de papel en el pecho */}
        <g className="m-torso">
          <path className="m-cuerpo" d="M74 106 L166 106 L182 150 L162 194 L78 194 L58 150 Z" />
          <g clipPath="url(#m-clip-cuerpo)">
            <ellipse
              className="m-lavado"
              cx="120"
              cy="150"
              rx="76"
              ry="56"
              fill="url(#m-lavado-g)"
            />
          </g>
          {/* La ventanilla queda SIEMPRE, con o sin número: es un hueco de
              papel en la silueta de tinta, igual que el visor. Sacarla dejaría
              el pecho como un bloque macizo y el recorte del robot cambia. */}
          <rect className="m-hueco" x="90" y="122" width="60" height="40" rx="6" />
          {numero !== null && (
            <text className="m-numero" x="120" y="149" textAnchor="middle">
              {numero}
            </text>
          )}
          {/* Tres nervaduras, no una barra: dan la sensación de chasis tenso. */}
          <rect className="m-hueco" x="98" y="170" width="44" height="3" rx="1.5" />
          <rect className="m-hueco" x="104" y="177" width="32" height="3" rx="1.5" />
          <rect className="m-hueco" x="110" y="184" width="20" height="3" rx="1.5" />
        </g>

        {/* Cabeza: una visera baja y ancha que se orienta a la luz */}
        <g className="m-cabeza">
          {/* La antena es el punto de luz del robot: el único amarillo acá. */}
          <path className="m-cuerpo" d="M117 12 L123 12 L125 32 L115 32 Z" />
          <circle className="m-antena-lente" cx="120" cy="8" r="7" />
          <circle className="m-antena-aro" cx="120" cy="8" r="7" />

          {/* El casco: hexágono achatado, más ancho que alto. Un centinela que
              todo lo ve tiene la cabeza dominada por la mirada, no por el cráneo. */}
          <path className="m-cuerpo" d="M46 30 L194 30 L206 74 L184 96 L56 96 L34 74 Z" />
          <g clipPath="url(#m-clip-cabeza)">
            <ellipse
              className="m-lavado"
              cx="120"
              cy="62"
              rx="88"
              ry="44"
              fill="url(#m-lavado-g)"
            />
          </g>

          {/* EL VISOR. Una sola ranura ancha en vez de dos ojos: la mirada
              cubre casi todo el ancho de la cabeza, y eso es lo que dice que
              no se le escapa nada. */}
          <path className="m-hueco m-visor" d="M52 46 L188 46 L196 72 L178 84 L62 84 L44 72 Z" />

          <g className="m-ojos" clipPath="url(#m-clip-visor)">
            {/* El barrido: una línea que cruza el visor sin parar. Es lo que
                hace que la mirada se lea ACTIVA y no fija. */}
            <rect className="m-barrido" x="-30" y="46" width="26" height="38" />

            {/* El iris: una sola pupila alargada que corre a lo ancho del
                visor persiguiendo la luz. Recorre mucho más que las pupilas
                redondas de antes — de ahí sale la sensación de reacción. */}
            <g className="m-pupilas">
              <rect x="104" y="52" width="32" height="26" rx="6" />
              <rect className="m-iris-nucleo" x="114" y="57" width="12" height="16" rx="4" />
            </g>

            {/* Párpado: una persiana única que baja sobre todo el visor cuando
                el agente todavía no arrancó. */}
            <g className="m-parpados">
              <rect x="44" y="44" width="152" height="42" />
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
