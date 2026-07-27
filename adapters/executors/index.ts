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
 * Único lugar del módulo que toca la red. Recibe la petición ya armada por
 * el canal correspondiente y reporta el resultado.
 *
 * El `detail` describe la acción por su descripción pública (la del config
 * de dominio), nunca por la URL o el token ya resueltos: un secreto que
 * entra acá no debe poder salir en ningún resultado ni error. Si `fetchImpl`
 * tira una excepción (p. ej. un error de red cuyo mensaje podría incluir la
 * URL), se atrapa y se reporta un detalle genérico.
 */
async function post(
  action: Action,
  build: BuildResult,
  fetchImpl: FetchImpl,
): Promise<ExecutionResult> {
  if (!build.ok) return { ok: false, detail: `Falta la variable ${build.missing}` }

  try {
    const response = await fetchImpl(build.request.url, build.request.init)
    return response.ok
      ? { ok: true, detail: `${action.description} — enviado (${response.status})` }
      : { ok: false, detail: `${action.description} — falló con ${response.status}` }
  } catch {
    return { ok: false, detail: `${action.description} — no se pudo enviar` }
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
      return post(action, buildDiscordRequest(config, action.config, decision, detection), fetchImpl)

    case "ntfy":
      return post(action, buildNtfyRequest(config, action.config, decision, detection), fetchImpl)

    case "webhook":
      return post(action, buildWebhookRequest(config, action.config, decision, detection), fetchImpl)

    case "github_issue":
      return post(
        action,
        buildGithubIssueRequest(config, action.config, decision, detection),
        fetchImpl,
      )
  }
}
