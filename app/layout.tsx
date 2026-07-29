import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Instrument_Serif } from "next/font/google"
import "./globals.css"

/*
 * Instrument Serif, auto-hosteada por `next/font/google`: Next descarga los
 * archivos en build y los sirve desde el propio dominio, así que no hay un
 * <link> a un CDN ni una request a Google en runtime.
 *
 * Es la ÚNICA fuente que se descarga. El cuerpo usa el stack del sistema a
 * propósito (ver DESIGN.md § Tipografía): esta dirección quiere una cara de
 * texto neutra y casi invisible, y una segunda fuente sólo sumaría riesgo de
 * red en el build de Vercel.
 *
 * Se pide la itálica porque la segunda línea del título la usa.
 */
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--display",
})

/*
 * Un solo modo, el claro. No hay script de arranque de tema ni preferencia
 * guardada: `globals.css` fija `color-scheme: light` y con eso alcanza para
 * que los controles nativos pinten bien. Ver DESIGN.md § Color.
 */
export const metadata: Metadata = {
  title: "Reflex Agent — el mismo motor, dos dominios",
  description:
    "Un agente de monitoreo que detecta patrones en el tiempo, decide con Claude y ejecuta. Mismo motor para estaciones de carga y para mesas de restaurante.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={display.variable}>
      <body>{children}</body>
    </html>
  )
}
