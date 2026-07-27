import type { NextConfig } from "next"

/**
 * Todo el código de este repo importa con extensión `.js` apuntando a
 * archivos `.ts` (`./intervals.js` → `intervals.ts`), que es lo que pide
 * `moduleResolution` de TypeScript para ESM. Turbopack no hace ese mapeo y
 * no soporta `experimental.extensionAlias` — está en su lista de opciones
 * ignoradas — así que `dev`, `build` y `start` corren con webpack, que sí lo
 * hace. La alternativa era reescribir todos los imports de /engine,
 * /adapters y /simulators, código ya revisado y con tests pasando.
 *
 * Si algún día se quiere volver a Turbopack: sacar `--webpack` de los
 * scripts y sacarle la extensión a todos los imports relativos.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // El repo usa TypeScript 7, que ya no expone la compiler API que Next
    // consume por defecto. Con esto Next invoca el CLI (`tsc --noEmit`) para
    // chequear tipos durante el build, en vez de la API interna.
    useTypeScriptCli: true,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
}

export default nextConfig
