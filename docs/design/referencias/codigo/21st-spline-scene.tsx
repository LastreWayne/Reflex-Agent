// REFERENCIA — no es código del proyecto. Pegado por el humano el 2026-07-27.
//
// Qué es: wrapper de <Spline> (escenas 3D de spline.design) con carga diferida
// vía lazy + Suspense. Patrón típico de un hero con pieza 3D interactiva.
//
// DEPENDENCIA DURA: necesita `scene`, que es una URL a un archivo .splinecode
// alojado en la nube de Spline. Ese archivo se crea en el editor de Spline —
// no se puede generar desde código. Por eso, con el deadline encima, la mascota
// se hace en SVG/CSS y este patrón queda como referencia para después.
//
// Lo que SÍ se reutiliza de acá: lazy + Suspense + fallback, para que la pieza
// pesada nunca bloquee el render del dashboard.

'use client'

import { Suspense, lazy } from 'react'
const Spline = lazy(() => import('@splinetool/react-spline'))

interface SplineSceneProps {
  scene: string
  className?: string
}

export function SplineScene({ scene, className }: SplineSceneProps) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center">
          <span className="loader"></span>
        </div>
      }
    >
      <Spline
        scene={scene}
        className={className}
      />
    </Suspense>
  )
}
