/*
 * Las líneas de flujo del hero: adaptación de `references/background-paths.tsx`,
 * el componente que pinneó el humano.
 *
 * Se toma SÓLO `FloatingPaths`: la geometría de los 36 paths cúbicos, montada
 * dos veces (`position` 1 y −1), que se dibujan y viajan sobre su propio largo
 * en un loop lineal lento mientras la opacidad late. El wrapper
 * `BackgroundPaths` de la referencia se descarta entero: trae su propio hero,
 * su propio título animado letra por letra y un `Button` de shadcn, y nosotros
 * ya tenemos la composición que pidió el humano.
 *
 * Las cinco adaptaciones, con su porqué:
 *
 *  1. **Sin framer-motion.** Lo que la referencia anima —`pathLength`,
 *     `pathOffset` y `opacity` en loop lineal— es exactamente
 *     `stroke-dasharray` + `stroke-dashoffset` + un keyframe de opacidad. Con
 *     `pathLength="1"` los valores del dash quedan normalizados (el largo real
 *     de cada curva deja de importar) y `dashoffset: 0 → −1` recorre el path
 *     entero una vez por vuelta, sin costura. Cero dependencia nueva, cero
 *     cambio de lockfile a horas del deploy, y el navegador maneja el loop.
 *
 *  2. **Sin `Math.random()`.** La referencia usa `20 + Math.random() * 10`
 *     para la duración, que rompe la regla dura del proyecto. Acá la duración
 *     sale del índice: `21 + ((i * 7) % 11)` da 21–31 s con un reparto que no
 *     se lee como escalera, y es idéntico en el servidor y en el navegador.
 *
 *  3. **Sin Tailwind.** Todo pasa por los tokens de `globals.css` § 5.
 *
 *  4. **Recoloreado.** La referencia es slate con rama de modo oscuro. Acá es
 *     tinta sobre papel: un dibujo callado. El amarillo NO se reparte por el
 *     campo — sólo `LINEAS_ORO` líneas puntuales lo llevan.
 *
 *  5. **`prefers-reduced-motion`.** Las líneas quedan quietas y COMPLETAS; no
 *     se ocultan.
 *
 * Sobre el costo: el latido de opacidad NO va por trazo. Medido, animar
 * `opacity` en cada `<path>` repinta el SVG entero cada cuadro y tira la
 * página a 21 fps; con el pulso mudado al `<svg>` (capa propia) y sólo el
 * dash por trazo, son 60 fps con los 72 trazos puestos. El detalle está en
 * `globals.css` § 4, y `docs/design/mirar.mjs` imprime la medición.
 *
 * El único acoplamiento con la página es que el elemento raíz lleva
 * `className="fondo-flujo"`, que `globals.css` ya posiciona detrás del marco.
 */

import type { CSSProperties } from "react"

/**
 * Cuántos paths por dirección. Dos direcciones ⇒ el doble en pantalla.
 *
 * 36 es el número de la referencia, y hay una razón para no bajarlo: los
 * trazos consecutivos están a (5, −6) unidades uno de otro, así que la
 * cantidad ES el ancho de la cinta. Con 24 el abanico se volvía un hilo.
 * A 72 trazos en pantalla el fondo mide 60 fps (ver `globals.css` § 4), así
 * que no hace falta recortar.
 */
const POR_DIRECCION = 36

/** Cuáles de los índices llevan oro en vez de tinta. Pocos, a propósito. */
const LINEAS_ORO = new Set([6, 19, 31])

/**
 * La curva de la referencia, tal cual: dos cúbicas que barren de arriba a la
 * izquierda hacia abajo a la derecha. `posicion` (1 / −1) espeja el sesgo
 * horizontal, que es lo que produce el cruce de los dos abanicos.
 */
function curva(i: number, posicion: number): string {
  const sesgo = i * 5 * posicion
  return (
    `M-${380 - sesgo} -${189 + i * 6}` +
    `C-${380 - sesgo} -${189 + i * 6} -${312 - sesgo} ${216 - i * 6} ${152 - sesgo} ${343 - i * 6}` +
    `C${616 - sesgo} ${470 - i * 6} ${684 - sesgo} ${875 - i * 6} ${684 - sesgo} ${875 - i * 6}`
  )
}

interface Linea {
  clave: string
  d: string
  grosor: number
  /** Opacidad base del trazo. La animación de opacidad la multiplica. */
  opacidad: number
  /** Segundos por vuelta. Derivada del índice, nunca del azar. */
  duracion: number
  /**
   * Retraso NEGATIVO, en segundos: arranca la animación ya empezada.
   *
   * Sin esto los 72 trazos entran en fase y el campo entero aparece amontonado
   * en el arranque de las curvas — arriba a la izquierda — con el resto del
   * marco vacío. El desfase los reparte a lo largo del ciclo desde el primer
   * cuadro. Sale del índice, nunca del azar.
   */
  desfase: number
  /** Fracción del path visible por vez, normalizada por `pathLength="1"`. */
  visible: number
  oro: boolean
}

const LINEAS: Linea[] = [1, -1].flatMap((posicion) =>
  Array.from({ length: POR_DIRECCION }, (_, i): Linea => {
    const duracion = 21 + ((i * 7) % 11)
    // 37 y 100 son coprimos: recorre las cien fases sin repetir. El 53 corre
    // el segundo abanico para que no calque al primero.
    const fase = ((i * 37 + (posicion === 1 ? 0 : 53)) % 100) / 100
    return {
      clave: `${posicion}-${i}`,
      d: curva(i, posicion),
      grosor: 0.5 + i * 0.04,
      // El techo (0.79 en el índice 35) NO es gusto: es el valor más alto que
      // deja pasar el contraste del texto sobre el vidrio en el peor momento
      // del campo. Subirlo obliga a volver a correr docs/design/contraste.mjs.
      opacidad: 0.12 + i * 0.019,
      duracion,
      desfase: -(duracion * fase),
      visible: 0.3 + ((i * 3) % 7) * 0.05,
      oro: LINEAS_ORO.has(i) && posicion === 1,
    }
  }),
)

export function FondoFlujo() {
  return (
    <div className="fondo-flujo" aria-hidden="true">
      {/*
        El viewBox NO es el de la referencia (`0 0 696 316`), que con recorte
        a pantalla completa dejaba el abanico afuera. Los dos abanicos se
        cruzan alrededor de (150, 240): esta ventana centra ese cruce y deja
        las colas saliendo por las esquinas. Relación 1.6, la de una pantalla
        típica, así que en escritorio no se recorta casi nada.
      */}
      <svg
        className="fondo-flujo-svg"
        viewBox="-250 -10 800 500"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        {LINEAS.map((l) => (
          <path
            key={l.clave}
            className="flujo-linea"
            data-flujo={l.oro ? "oro" : "tinta"}
            d={l.d}
            pathLength="1"
            strokeWidth={l.grosor}
            strokeOpacity={l.opacidad}
            style={
              {
                "--dur": `${l.duracion}s`,
                "--desfase": `${l.desfase.toFixed(2)}s`,
                "--visible": l.visible,
                "--hueco": 1 - l.visible,
              } as CSSProperties
            }
          />
        ))}
      </svg>
    </div>
  )
}
