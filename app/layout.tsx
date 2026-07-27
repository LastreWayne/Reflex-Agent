import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Centinela — el mismo motor, dos dominios",
  description:
    "Un agente de monitoreo que detecta patrones en el tiempo, decide con Claude y ejecuta. Mismo motor para estaciones de carga y para mesas de restaurante.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
