/**
 * Resuelve las referencias `env:NOMBRE` dentro de un config publicable.
 *
 * Este es el único punto donde un secreto entra en juego: los configs de
 * dominio (configs/*.json) son públicos y sólo contienen el nombre de la
 * variable de entorno, nunca el valor. La resolución pasa acá, en el
 * servidor, en el momento de ejecutar la acción — nunca antes.
 */
export function resolveEnv(
  config: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && value.startsWith("env:")) {
      resolved[key] = env[value.slice(4)] ?? null
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

/** Un campo de config ya resuelto, o el nombre de la variable de entorno que faltaba. */
export type RequiredField = { value: string } | { missing: string }

/**
 * Exige que `key` sea un string no vacío en el config ya resuelto (post
 * `resolveEnv`). Si falta, devuelve el nombre de la variable de entorno
 * original — nunca el valor — para poder armar un mensaje de error útil
 * sin filtrar nada sensible.
 */
export function requireString(
  resolved: Record<string, unknown>,
  key: string,
  raw: Record<string, unknown>,
): RequiredField {
  const value = resolved[key]
  if (typeof value === "string" && value.length > 0) return { value }
  const original = raw[key]
  const name = typeof original === "string" ? original.replace(/^env:/, "") : key
  return { missing: name }
}

/** La petición HTTP concreta que arma cada canal, antes de que index.ts la ejecute. */
export interface HttpRequest {
  url: string
  init: RequestInit
}

/** Resultado de armar una petición: la petición lista, o la variable que faltó. */
export type BuildResult = { ok: true; request: HttpRequest } | { ok: false; missing: string }
