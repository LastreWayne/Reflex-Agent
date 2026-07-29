import type { Action, Decision, Detection } from "../../engine/schema.js"
import { resolveEnv, type BuildResult } from "./resolve-env.js"
import { executeNoop } from "./noop.js"
import { executeStateMutation } from "./state-mutation.js"
import { buildDiscordRequest } from "./discord.js"
import { buildNtfyRequest } from "./ntfy.js"
import { buildWebhookRequest } from "./webhook.js"
import { buildGithubIssueRequest } from "./github-issue.js"

export interface ExecutionResult {
  ok: boolean
  detail: string
}

export type FetchImpl = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number }>

/**
 * Extrae sólo el host de una URL — nunca el path, que es donde vive el
 * secreto (el token de un webhook de Discord, el ID de un topic privado de
 * ntfy, etc.). Si la URL está mal formada, `new URL` tira: no dejamos que
 * eso tumbe el executor, y el fallback NO repite el string original — un
 * typo en la config también podría llevar un secreto pegado.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "host desconocido"
  }
}

/**
 * Único lugar del módulo que toca la red. Recibe la petición ya armada por
 * el canal correspondiente y reporta el resultado.
 *
 * El `detail` lleva el host contactado y el status code — útil para
 * depurar desde el dashboard — pero nunca el path, que es donde vive el
 * secreto ya resuelto. Si `fetchImpl` tira una excepción (p. ej. un error
 * de red cuyo mensaje podría incluir la URL completa), se atrapa y jamás
 * se propaga su contenido.
 */
async function post(build: BuildResult, fetchImpl: FetchImpl): Promise<ExecutionResult> {
  if (!build.ok) return { ok: false, detail: `Falta la variable ${build.missing}` }

  const host = hostOf(build.request.url)
  try {
    const response = await fetchImpl(build.request.url, build.request.init)
    return response.ok
      ? { ok: true, detail: `POST ${host} → ${response.status}` }
      : { ok: false, detail: `POST ${host} falló con ${response.status}` }
  } catch {
    return { ok: false, detail: `POST ${host} no se pudo enviar` }
  }
}

export async function execute(
  action: Action,
  decision: Decision,
  detection: Detection,
  env: Record<string, string | undefined>,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<ExecutionResult> {
  const config = resolveEnv(action.config, env)

  switch (action.type) {
    case "noop":
      return executeNoop()

    case "state_mutation":
      return executeStateMutation(config, detection)

    case "discord":
      return post(buildDiscordRequest(config, action.config, decision, detection), fetchImpl)

    case "ntfy":
      return post(buildNtfyRequest(config, action.config, decision, detection), fetchImpl)

    case "webhook":
      return post(buildWebhookRequest(config, action.config, decision, detection), fetchImpl)

    case "github_issue":
      return post(buildGithubIssueRequest(config, action.config, decision, detection), fetchImpl)
  }
}
