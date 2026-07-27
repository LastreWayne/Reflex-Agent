import type { Detection, EvalContext, Rule } from "../schema.js"
import { evaluateAbsenceOfEvents } from "./absence-of-events.js"
import { evaluateDurationInState } from "./duration-in-state.js"
import { evaluateDurationVsBaseline } from "./duration-vs-baseline.js"
import { evaluateFrequencyInWindow } from "./frequency-in-window.js"

export function evaluateRule(rule: Rule, ctx: EvalContext): Detection[] {
  switch (rule.type) {
    case "duration_in_state":
      return evaluateDurationInState(rule, ctx)
    case "duration_vs_baseline":
      return evaluateDurationVsBaseline(rule, ctx)
    case "absence_of_events":
      return evaluateAbsenceOfEvents(rule, ctx)
    case "frequency_in_window":
      return evaluateFrequencyInWindow(rule, ctx)
  }
}
