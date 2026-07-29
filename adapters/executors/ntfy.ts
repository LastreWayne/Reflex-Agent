import type { Decision, Detection } from "../../engine/schema.js"
import { requireString, type BuildResult } from "./resolve-env.js"

/** ntfy.sh: el mensaje va como cuerpo plano al topic resuelto. */
export function buildNtfyRequest(
  config: Record<string, unknown>,
  raw: Record<string, unknown>,
  decision: Decision,
  detection: Detection,
): BuildResult {
  const topic = requireString(config, "topic", raw)
  if ("missing" in topic) return { ok: false, missing: topic.missing }

  return {
    ok: true,
    request: {
      url: `https://ntfy.sh/${topic.value}`,
      init: {
        method: "POST",
        headers: {
          Title: detection.ruleId,
          Priority: detection.severity === "high" ? "high" : "default",
        },
        body: decision.message,
      },
    },
  }
}
