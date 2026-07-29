import type { Decision, Detection } from "../../engine/schema.js"
import { requireString, type BuildResult } from "./resolve-env.js"

/** Crea un issue en el repo vía la REST API de GitHub, autenticado con un token. */
export function buildGithubIssueRequest(
  config: Record<string, unknown>,
  raw: Record<string, unknown>,
  decision: Decision,
  detection: Detection,
): BuildResult {
  const repo = requireString(config, "repo", raw)
  if ("missing" in repo) return { ok: false, missing: repo.missing }

  const token = requireString(config, "token", raw)
  if ("missing" in token) return { ok: false, missing: token.missing }

  return {
    ok: true,
    request: {
      url: `https://api.github.com/repos/${repo.value}/issues`,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.value}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: `[${detection.severity}] ${detection.ruleId} — ${detection.entityId}`,
          body: `${decision.message}\n\n---\n\n**Razón del agente:** ${decision.reason}\n\n\`\`\`json\n${JSON.stringify(detection.evidence, null, 2)}\n\`\`\``,
        }),
      },
    },
  }
}
