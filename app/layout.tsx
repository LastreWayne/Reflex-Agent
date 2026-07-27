import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Archivo } from "next/font/google"
import "./globals.css"

/*
 * Archivo, auto-hosteada por `next/font/google`: Next descarga los archivos en
 * build y los sirve desde el propio dominio, así que no hay un <link> a un CDN
 * ni una request a Google en runtime. Se pide el eje `wdth` porque la
 * dirección usa Archivo Expanded para display (ver DESIGN.md § Tipografía);
 * sin el eje, `font-stretch` no haría nada sobre la variable font.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--fuente",
})

/*
 * Se corre antes del primer pintado para que el modo elegido a mano no
 * parpadee. Sin esto, la página pinta en claro y recién en el efecto de React
 * salta a oscuro. No lee `process.env` ni nada del bundle: sólo localStorage.
 */
const ARRANQUE_TEMA = `try{var t=localStorage.getItem("centinela:tema");if(t==="claro"||t==="oscuro"){document.documentElement.setAttribute("data-tema",t)}}catch(e){}`

export const metadata: Metadata = {
  title: "Centinela — el mismo motor, dos dominios",
  description:
    "Un agente de monitoreo que detecta patrones en el tiempo, decide con Claude y ejecuta. Mismo motor para estaciones de carga y para mesas de restaurante.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ARRANQUE_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
