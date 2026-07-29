"use client"

/*
 * VIDRIO LÍQUIDO — la superficie de vidrio del proyecto, como pieza reusable.
 *
 * Adaptado de `references/liquid-glass-card.tsx` mirando las tres capturas
 * (`references/liquidglass1..3.png`). De la referencia se toma la RECETA, que
 * es CSS + SVG puro, y se descarta framer-motion entero: ahí sólo maneja
 * drag, click-para-expandir y scale en hover, y no usamos ninguno de los tres.
 *
 * Qué hace liquid glass, leído de las capturas y no de la palabra:
 *
 *   1. EL FILO ES EL EFECTO. En las tres, lo primero que se ve es un canto
 *      fino que agarra luz. Acá hay una vuelta de tuerca obligatoria: las
 *      tres referencias son vidrio sobre fondo OSCURO, donde un filo blanco
 *      brilla. Sobre papel hueso el blanco solo no existe. La traducción a
 *      modo claro es un canto de dos líneas — hairline de `--linea-control`
 *      por fuera y filo blanco por dentro — que es exactamente el aro
 *      plateado de `liquidglass3.png`.
 *   2. EL CENTRO ES CASI TRANSPARENTE. No es un panel esmerilado.
 *   3. EL FONDO SE DOBLA AL CRUZAR EL VIDRIO (`liquidglass2.png`: el tallo de
 *      la flor se corre). Eso es `feTurbulence` + `feDisplacementMap`, y es
 *      LA diferencia con una caja borrosa.
 *   4. ESPECULARES donde la luz pega: el destello del canto de arriba y los
 *      dos brillos diagonales opuestos de `liquidglass3.png`.
 *
 * ── LOS DOS RIESGOS DE LA REFERENCIA, MEDIDOS EN CHROMIUM ANTES DE CONSTRUIR
 *
 * · `filter: url(#…)` sobre el MISMO elemento que lleva `backdrop-filter`
 *   NO sirve, y la razón es peor que "rompe en algunos navegadores": `filter`
 *   deforma al elemento ENTERO, su texto incluido. En la prueba el título
 *   adentro de la caja salió chorreado. Y puesto en una capa aparte no dobla
 *   nada, porque esa capa es transparente y no hay qué desplazar.
 *
 *   Lo que sí funciona es meter el filtro ADENTRO del backdrop-filter:
 *   `backdrop-filter: url(#filtro) blur() saturate()`. Ahí `SourceGraphic`
 *   ES el fondo, se dobla el fondo y el contenido queda intacto. Medido en
 *   Chromium: refracción visible y 60 fps con los 72 trazos corriendo.
 *
 *   El valor va INLINE y sin `var()` a propósito. Si el navegador no soporta
 *   `url()` adentro de backdrop-filter, la declaración inline se descarta al
 *   parsear y queda la de la hoja (`blur()` a secas): el vidrio pierde la
 *   refracción pero NUNCA pierde el desenfoque, que es lo que sostiene el
 *   contraste del texto. Con `var()` adentro eso no pasaría: una `var()` que
 *   falla en tiempo de cómputo tira la propiedad a su valor inicial (`none`)
 *   en vez de caer a la declaración anterior, y el texto quedaría sobre las
 *   líneas en crudo.
 *
 * · `scale='200'` de la referencia es enorme. Acá el default es 26 y el techo
 *   práctico ronda 40: más que eso y el canto empieza a chupar píxeles de
 *   afuera de la región del filtro.
 */

import { useId, type CSSProperties, type ReactNode } from "react"

export interface OpcionesVidrio {
  /** Clase propia de la superficie. Se suma a `vidrio`. */
  clase?: string
  /**
   * Cuánto papel lleva el vidrio, de 0 (invisible) a 1 (opaco).
   *
   * NO es gusto: es lo que decide si el texto de arriba pasa contraste sobre
   * el momento más oscuro del fondo. Ver `docs/design/contraste.mjs`.
   */
  tinte?: number
  /** Radio del canto. Cualquier longitud CSS, incluida una `var()`. */
  radio?: string
  /**
   * Desenfoque del fondo. Longitud CSS LITERAL, sin `var()`: entra tal cual
   * en el valor inline de `backdrop-filter` (ver la nota de arriba).
   */
  desenfoque?: string
  /** Saturación del fondo detrás del vidrio. */
  saturacion?: number
  /**
   * Cuánto dobla el fondo al cruzar el vidrio (`feDisplacementMap scale`).
   * `0` apaga la refracción y no emite el filtro.
   */
  refraccion?: number
  /** Brillo del filo interno, 0–1. Es lo que más se ve del efecto. */
  filo?: number
  /** Halo exterior, 0–1. */
  halo?: number
  /** Fuerza de los especulares, 0–1. */
  lustre?: number
}

/** Lo que hay que poner en el elemento que ES la superficie de vidrio. */
export interface AtributosVidrio {
  className: string
  style: CSSProperties
  "data-vidrio": "refracta" | "liso"
}

/**
 * Devuelve los atributos de la superficie y las capas que van adentro.
 *
 * Es un hook y no un componente envolvente porque la superficie a veces
 * TIENE que ser el elemento interactivo — las pestañas son `<button>`, y el
 * hover, el foco y el `data-abierta` viven ahí. Con un wrapper habría que
 * elegir entre el vidrio y el botón.
 *
 *     const { vidrio, capas } = useVidrio({ clase: "pestana-boton", tinte: 0.86 })
 *     <button {...vidrio}>{capas}{hijos}</button>
 */
export function useVidrio({
  clase,
  tinte = 0.3,
  radio = "var(--radio-marco)",
  desenfoque = "9px",
  saturacion = 1.12,
  refraccion = 0,
  filo = 0.9,
  halo = 0.1,
  lustre = 0.55,
}: OpcionesVidrio = {}): { vidrio: AtributosVidrio; capas: ReactNode } {
  // `useId` es estable entre servidor y navegador, así que no hay mismatch de
  // hidratación. Se le sacan los signos raros porque el id termina adentro de
  // un `url(#…)`.
  const id = `vidrio-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const refracta = refraccion > 0
  const bruto = `url(#${id}) blur(${desenfoque}) saturate(${saturacion})`

  const style = {
    "--vidrio-tinte": tinte,
    "--vidrio-radio": radio,
    "--vidrio-desenfoque": desenfoque,
    "--vidrio-saturacion": saturacion,
    "--vidrio-filo": filo,
    "--vidrio-halo": halo,
    "--vidrio-lustre": lustre,
    ...(refracta ? { backdropFilter: bruto, WebkitBackdropFilter: bruto } : null),
  } as CSSProperties

  return {
    vidrio: {
      className: clase ? `vidrio ${clase}` : "vidrio",
      style,
      "data-vidrio": refracta ? "refracta" : "liso",
    },
    capas: (
      <>
        {refracta && (
          <svg className="vidrio-filtro" aria-hidden="true" focusable="false">
            <filter
              id={id}
              /*
               * La región es EXACTAMENTE el elemento, y esto no es un detalle:
               * medido, agrandarla al 124% para que el canto no chupe píxeles
               * de afuera tira la página de 37 fps a 4. Chromium deja de
               * poder recortar el backdrop y recalcula la turbulencia sobre
               * una superficie mucho más grande en cada cuadro. Con la región
               * justa el canto se resuelve con un `scale` moderado.
               */
              x="0%"
              y="0%"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              {/*
                La frecuencia decide si el efecto se VE. Con 0.004 la onda es
                tan larga que sobre un hero grande el fondo entero se corre
                parejo — y un desplazamiento uniforme es indistinguible de
                ninguno. Subida a 0.016/0.022, la deformación VARÍA a lo ancho
                de la superficie: eso es lo que se lee como vidrio y no como
                una capa movida. La semilla es literal — nada de Math.random().
              */}
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.016 0.022"
                numOctaves={2}
                seed={4}
                result="ondas"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="ondas"
                scale={refraccion}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </svg>
        )}
        <span className="vidrio-lustre" aria-hidden="true" />
      </>
    ),
  }
}

export interface VidrioLiquidoProps extends OpcionesVidrio {
  children: ReactNode
  /** Clase del cuerpo, que es donde va el padding y el layout del contenido. */
  claseCuerpo?: string
  id?: string
}

/**
 * El caso común: una superficie de vidrio que envuelve contenido.
 *
 * El contenido va en su propia capa por encima del lustre; el padding vive en
 * el cuerpo y no en la superficie, para que los especulares y el filo cubran
 * el panel entero.
 */
export function VidrioLiquido({
  children,
  claseCuerpo,
  id,
  ...opciones
}: VidrioLiquidoProps) {
  const { vidrio, capas } = useVidrio(opciones)
  return (
    <div {...vidrio} id={id}>
      {capas}
      <div className={claseCuerpo ? `vidrio-cuerpo ${claseCuerpo}` : "vidrio-cuerpo"}>
        {children}
      </div>
    </div>
  )
}
