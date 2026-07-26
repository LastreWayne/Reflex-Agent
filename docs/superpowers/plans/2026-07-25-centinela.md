# Centinela — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un motor de monitoreo donde cambiar de dominio es cargar otro JSON, con un playground web público que lo demuestre sobre dos dominios que no se parecen en nada.

**Architecture:** Un núcleo de funciones puras en `/engine` sin I/O ni red, que corre igual en el navegador que en Node. Alrededor, adapters intercambiables para el decisor (Claude), los executors y el store. Encima, un Next.js que es a la vez el dashboard de demo y el servidor que guarda la API key.

**Tech Stack:** TypeScript · Next.js 15 (App Router) · Zod · Vitest · `@anthropic-ai/sdk` · Vercel

## Global Constraints

- **`/engine` no importa nada de Node ni hace red.** Sin `fs`, sin `process`, sin `fetch`. Es la regla que hace que el motor corra en el navegador. Si un test necesita mockear I/O dentro de `/engine`, el diseño está mal.
- **El tiempo se inyecta, nunca se lee.** Toda función que dependa de "ahora" recibe `now: Date` como parámetro. Sin `Date.now()` ni `new Date()` dentro de `/engine`.
- **Modelo Claude: `claude-opus-5`.** Exacto, sin sufijo de fecha.
- **Nunca desactivar el thinking en el decisor.** Con `thinking: { type: "disabled" }` Opus 5 a veces escribe la tool call como texto plano y la acción nunca se ejecuta, sin error. La latencia se controla con `output_config: { effort: "low" }`.
- **Secretos vía `env:`.** Dentro de `actions[].config`, un string con prefijo `env:` se resuelve contra una variable de entorno **en el servidor, al ejecutar**. Los configs son publicables sin filtrar webhooks ni tokens.
- **Nada de `any`.** `strict: true` en `tsconfig`.
- Idioma del código y los identificadores: inglés. Idioma de los mensajes al usuario y los configs: español.

---

## Estructura de archivos

```
/engine
  schema.ts            Zod + tipos derivados. Nadie define tipos de dominio fuera de acá.
  normalizer.ts        entrada cruda → NormalizedEvent[] validado y ordenado
  intervals.ts         NormalizedEvent[] → Interval[]
  detector.ts          orquesta los evaluadores + supresión (dedup y cooldown)
  rules/
    duration-in-state.ts
    absence-of-events.ts
    frequency-in-window.ts
    duration-vs-baseline.ts
    index.ts           registry: type → evaluator
/adapters
  store/memory.ts      StateStore en memoria
  decider/claude.ts    decide(detection, config) → Decision
  executors/
    index.ts           dispatch por action.type
    discord.ts  ntfy.ts  webhook.ts  github-issue.ts  state-mutation.ts  noop.ts
    resolve-env.ts     resuelve los "env:" del config
/simulators
  volt-ocpp.ts         generador determinístico de eventos de estaciones
  restaurant.ts        generador determinístico de eventos de mesas
  rng.ts               PRNG con seed (mulberry32)
/configs
  volt.json  restaurant.json
/app
  page.tsx             dashboard de cinco carriles
  api/decide/route.ts  api/execute/route.ts  api/generate-config/route.ts
```

---

## Fase 1 — El motor (Tasks 1-7)

### Task 1: Scaffold y contrato de datos

Todo lo demás depende de estos tipos. Es la tarea que más barato es hacer bien y más caro es rehacer.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `engine/schema.ts`
- Test: `engine/schema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `NormalizedEventSchema`, `DomainConfigSchema`, y los tipos `NormalizedEvent`, `Interval`, `Rule`, `Action`, `Severity`, `Detection`, `Decision`, `DomainConfig`, `EvalContext`.

- [ ] **Step 1: Inicializar el proyecto**

```bash
npm init -y
npm install zod @anthropic-ai/sdk
npm install -D typescript vitest @types/node
```

Reemplazar el campo `scripts` de `package.json` por:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Y agregar `"type": "module"` al mismo `package.json`.

- [ ] **Step 2: Configurar TypeScript y Vitest**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  },
  "include": ["engine", "adapters", "simulators", "app"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: { include: ["**/*.test.ts"] },
})
```

- [ ] **Step 3: Escribir el test del schema**

`engine/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DomainConfigSchema, NormalizedEventSchema } from "./schema.js"

describe("NormalizedEventSchema", () => {
  it("aplica metadata vacía por defecto", () => {
    const parsed = NormalizedEventSchema.parse({
      entityId: "EVC-01",
      timestamp: "2026-07-25T10:00:00.000Z",
      state: "Charging",
    })
    expect(parsed.metadata).toEqual({})
  })

  it("rechaza un evento sin entityId", () => {
    expect(() =>
      NormalizedEventSchema.parse({ timestamp: "2026-07-25T10:00:00.000Z", state: "Charging" }),
    ).toThrow()
  })
})

describe("DomainConfigSchema", () => {
  const base = {
    domain: "volt",
    displayName: "VOLT",
    entity: { singular: "estación", plural: "estaciones" },
    states: ["Available", "Faulted"],
    context: "Red de carga.",
    actions: [{ id: "ignore", type: "noop", description: "No hacer nada" }],
    cooldownMs: 900000,
  }

  it("discrimina las reglas por type", () => {
    const parsed = DomainConfigSchema.parse({
      ...base,
      rules: [
        {
          id: "faulted-stuck",
          type: "duration_in_state",
          state: "Faulted",
          thresholdMs: 600000,
          severity: "high",
          description: "Estación atascada en falla",
        },
      ],
    })
    const rule = parsed.rules[0]!
    expect(rule.type).toBe("duration_in_state")
    if (rule.type === "duration_in_state") expect(rule.thresholdMs).toBe(600000)
  })

  it("rechaza una regla con un type desconocido", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...base,
        rules: [{ id: "x", type: "telepatia", severity: "low", description: "no" }],
      }),
    ).toThrow()
  })

  it("rechaza una acción con un type que no es executor conocido", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...base,
        rules: [],
        actions: [{ id: "x", type: "paloma-mensajera", description: "no" }],
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — no existe `engine/schema.ts`.

- [ ] **Step 5: Escribir el schema**

`engine/schema.ts`:

```ts
import { z } from "zod"

export const SeveritySchema = z.enum(["low", "medium", "high"])
export type Severity = z.infer<typeof SeveritySchema>

export const NormalizedEventSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().optional(),
  timestamp: z.string(),
  state: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>

export interface Interval {
  entityId: string
  state: string
  startedAt: string
  endedAt: string | null
  durationMs: number
  isOpen: boolean
  metadata: Record<string, unknown>
}

const ruleBase = {
  id: z.string().min(1),
  severity: SeveritySchema,
  description: z.string().min(1),
}

export const RuleSchema = z.discriminatedUnion("type", [
  z.object({
    ...ruleBase,
    type: z.literal("duration_in_state"),
    state: z.string().min(1),
    thresholdMs: z.number().positive(),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("duration_vs_baseline"),
    state: z.string().min(1),
    percentile: z.number().min(1).max(99),
    minSamples: z.number().int().positive(),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("absence_of_events"),
    windowMs: z.number().positive(),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("frequency_in_window"),
    toState: z.string().min(1),
    windowMs: z.number().positive(),
    count: z.number().int().positive(),
    groupBy: z.string().optional(),
  }),
])
export type Rule = z.infer<typeof RuleSchema>

export const ActionTypeSchema = z.enum([
  "discord",
  "ntfy",
  "webhook",
  "github_issue",
  "state_mutation",
  "noop",
])
export type ActionType = z.infer<typeof ActionTypeSchema>

export const ActionSchema = z.object({
  id: z.string().min(1),
  type: ActionTypeSchema,
  description: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
})
export type Action = z.infer<typeof ActionSchema>

export const DomainConfigSchema = z.object({
  domain: z.string().min(1),
  displayName: z.string().min(1),
  entity: z.object({ singular: z.string().min(1), plural: z.string().min(1) }),
  states: z.array(z.string().min(1)).min(1),
  context: z.string().min(1),
  rules: z.array(RuleSchema),
  actions: z.array(ActionSchema).min(1),
  cooldownMs: z.number().nonnegative(),
})
export type DomainConfig = z.infer<typeof DomainConfigSchema>

export interface Detection {
  ruleId: string
  entityId: string
  detectedAt: string
  severity: Severity
  evidence: Record<string, unknown>
  /** Un disparo por ocurrencia concreta. Incluye el inicio del intervalo. */
  dedupKey: string
  /** Ventana de silencio por entidad+regla. */
  cooldownKey: string
}

export interface Decision {
  actionId: string
  reason: string
  message: string
}

export interface EvalContext {
  intervals: Interval[]
  events: NormalizedEvent[]
  now: Date
}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts engine/schema.ts engine/schema.test.ts
git commit -m "feat(engine): contrato de datos con Zod"
```

---

### Task 2: Normalizador

**Files:**
- Create: `engine/normalizer.ts`
- Test: `engine/normalizer.test.ts`

**Interfaces:**
- Consumes: `NormalizedEventSchema`, `NormalizedEvent` de `engine/schema.ts`.
- Produces: `normalize(raw: unknown[]): NormalizedEvent[]` — valida cada entrada y devuelve la lista **ordenada ascendente por timestamp**. Lanza `ZodError` si alguna entrada es inválida.

Fuera de alcance: mapeo de campos configurable para webhooks de terceros. Hoy la entrada ya viene con la forma del schema; el mapeo entra después sin tocar a los consumidores.

- [ ] **Step 1: Escribir el test que falla**

`engine/normalizer.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { normalize } from "./normalizer.js"

describe("normalize", () => {
  it("ordena los eventos por timestamp ascendente", () => {
    const result = normalize([
      { entityId: "A", timestamp: "2026-07-25T10:05:00.000Z", state: "Charging" },
      { entityId: "A", timestamp: "2026-07-25T10:00:00.000Z", state: "Available" },
    ])
    expect(result.map((e) => e.state)).toEqual(["Available", "Charging"])
  })

  it("conserva la metadata", () => {
    const result = normalize([
      { entityId: "A", timestamp: "2026-07-25T10:00:00.000Z", state: "Charging", metadata: { zone: "norte" } },
    ])
    expect(result[0]!.metadata).toEqual({ zone: "norte" })
  })

  it("lanza si un evento es inválido", () => {
    expect(() => normalize([{ entityId: "A", state: "Charging" }])).toThrow()
  })

  it("devuelve lista vacía para entrada vacía", () => {
    expect(normalize([])).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run engine/normalizer.test.ts`
Expected: FAIL — no existe `engine/normalizer.ts`.

- [ ] **Step 3: Implementar**

`engine/normalizer.ts`:

```ts
import { NormalizedEventSchema, type NormalizedEvent } from "./schema.js"

export function normalize(raw: unknown[]): NormalizedEvent[] {
  return raw
    .map((entry) => NormalizedEventSchema.parse(entry))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run engine/normalizer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/normalizer.ts engine/normalizer.test.ts
git commit -m "feat(engine): normalizador de eventos"
```

---

### Task 3: Intervalos — el primitivo de VOLT

Convertir eventos de cambio de estado en intervalos de duración. Es la pieza que hace que el motor sirva para cualquier entidad con estados que cambian en el tiempo.

**Files:**
- Create: `engine/intervals.ts`
- Test: `engine/intervals.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`, `Interval` de `engine/schema.ts`.
- Produces: `toIntervals(events: NormalizedEvent[], now: Date): Interval[]` — agrupa por `entityId`, cierra cada intervalo cuando el estado cambia, y deja el último abierto (`endedAt: null`, `isOpen: true`) con `durationMs` medido hasta `now`. Devuelve todos los intervalos de todas las entidades, ordenados por `startedAt`.

Reglas de comportamiento:
- Eventos consecutivos con el **mismo** estado no abren un intervalo nuevo: se ignoran como repetición.
- La `metadata` del intervalo es la del evento que lo **abrió**.

- [ ] **Step 1: Escribir el test que falla**

`engine/intervals.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { toIntervals } from "./intervals.js"
import type { NormalizedEvent } from "./schema.js"

const ev = (entityId: string, minute: number, state: string, metadata = {}): NormalizedEvent => ({
  entityId,
  timestamp: `2026-07-25T10:${String(minute).padStart(2, "0")}:00.000Z`,
  state,
  metadata,
})

const NOW = new Date("2026-07-25T10:30:00.000Z")

describe("toIntervals", () => {
  it("cierra un intervalo cuando cambia el estado", () => {
    const [first] = toIntervals([ev("A", 0, "Available"), ev("A", 10, "Charging")], NOW)
    expect(first).toMatchObject({
      entityId: "A",
      state: "Available",
      startedAt: "2026-07-25T10:00:00.000Z",
      endedAt: "2026-07-25T10:10:00.000Z",
      durationMs: 600000,
      isOpen: false,
    })
  })

  it("deja el último intervalo abierto y lo mide hasta now", () => {
    const intervals = toIntervals([ev("A", 0, "Available"), ev("A", 10, "Charging")], NOW)
    const last = intervals[intervals.length - 1]!
    expect(last).toMatchObject({
      state: "Charging",
      endedAt: null,
      isOpen: true,
      durationMs: 1200000,
    })
  })

  it("ignora eventos consecutivos con el mismo estado", () => {
    const intervals = toIntervals(
      [ev("A", 0, "Charging"), ev("A", 5, "Charging"), ev("A", 10, "Available")],
      NOW,
    )
    expect(intervals).toHaveLength(2)
    expect(intervals[0]!.durationMs).toBe(600000)
  })

  it("separa entidades distintas", () => {
    const intervals = toIntervals([ev("A", 0, "Charging"), ev("B", 0, "Faulted")], NOW)
    expect(intervals.map((i) => i.entityId).sort()).toEqual(["A", "B"])
    expect(intervals.every((i) => i.isOpen)).toBe(true)
  })

  it("toma la metadata del evento que abrió el intervalo", () => {
    const intervals = toIntervals(
      [ev("A", 0, "Charging", { zone: "norte" }), ev("A", 10, "Available", { zone: "sur" })],
      NOW,
    )
    expect(intervals[0]!.metadata).toEqual({ zone: "norte" })
  })

  it("devuelve lista vacía sin eventos", () => {
    expect(toIntervals([], NOW)).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run engine/intervals.test.ts`
Expected: FAIL — no existe `engine/intervals.ts`.

- [ ] **Step 3: Implementar**

`engine/intervals.ts`:

```ts
import type { Interval, NormalizedEvent } from "./schema.js"

export function toIntervals(events: NormalizedEvent[], now: Date): Interval[] {
  const byEntity = new Map<string, NormalizedEvent[]>()
  for (const event of events) {
    const bucket = byEntity.get(event.entityId)
    if (bucket) bucket.push(event)
    else byEntity.set(event.entityId, [event])
  }

  const intervals: Interval[] = []

  for (const entityEvents of byEntity.values()) {
    let open: Interval | null = null

    for (const event of entityEvents) {
      if (open && open.state === event.state) continue

      if (open) {
        open.endedAt = event.timestamp
        open.durationMs = Date.parse(event.timestamp) - Date.parse(open.startedAt)
        open.isOpen = false
        intervals.push(open)
      }

      open = {
        entityId: event.entityId,
        state: event.state,
        startedAt: event.timestamp,
        endedAt: null,
        durationMs: 0,
        isOpen: true,
        metadata: event.metadata,
      }
    }

    if (open) {
      open.durationMs = now.getTime() - Date.parse(open.startedAt)
      intervals.push(open)
    }
  }

  return intervals.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run engine/intervals.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/intervals.ts engine/intervals.test.ts
git commit -m "feat(engine): eventos de estado a intervalos de duración"
```

---

### Task 4: Regla `duration_in_state`

**Files:**
- Create: `engine/rules/duration-in-state.ts`
- Test: `engine/rules/duration-in-state.test.ts`

**Interfaces:**
- Consumes: `Interval`, `Detection`, `EvalContext`, `Rule` de `engine/schema.ts`.
- Produces: `evaluateDurationInState(rule, ctx: EvalContext): Detection[]`, donde `rule` es la variante `duration_in_state` de `Rule`.
- `dedupKey` = `` `${rule.id}:${entityId}:${interval.startedAt}` ``; `cooldownKey` = `` `${rule.id}:${entityId}` ``. **Los cuatro evaluadores usan exactamente esta forma de claves.**
- `evidence` = `{ state, durationMs, thresholdMs, startedAt }`.

- [ ] **Step 1: Escribir el test que falla**

`engine/rules/duration-in-state.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { evaluateDurationInState } from "./duration-in-state.js"
import type { EvalContext, Interval, Rule } from "../schema.js"

const rule = {
  id: "faulted-stuck",
  type: "duration_in_state",
  state: "Faulted",
  thresholdMs: 600000,
  severity: "high",
  description: "Estación atascada en falla",
} as const satisfies Extract<Rule, { type: "duration_in_state" }>

const interval = (over: Partial<Interval> = {}): Interval => ({
  entityId: "EVC-01",
  state: "Faulted",
  startedAt: "2026-07-25T10:00:00.000Z",
  endedAt: null,
  durationMs: 700000,
  isOpen: true,
  metadata: {},
  ...over,
})

const ctx = (intervals: Interval[]): EvalContext => ({
  intervals,
  events: [],
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateDurationInState", () => {
  it("dispara cuando la duración supera el umbral", () => {
    const [detection] = evaluateDurationInState(rule, ctx([interval()]))
    expect(detection).toMatchObject({
      ruleId: "faulted-stuck",
      entityId: "EVC-01",
      severity: "high",
      dedupKey: "faulted-stuck:EVC-01:2026-07-25T10:00:00.000Z",
      cooldownKey: "faulted-stuck:EVC-01",
    })
    expect(detection!.evidence).toMatchObject({ durationMs: 700000, thresholdMs: 600000 })
  })

  it("no dispara por debajo del umbral", () => {
    expect(evaluateDurationInState(rule, ctx([interval({ durationMs: 500000 })]))).toEqual([])
  })

  it("ignora intervalos de otro estado", () => {
    expect(evaluateDurationInState(rule, ctx([interval({ state: "Charging" })]))).toEqual([])
  })

  it("también dispara sobre intervalos ya cerrados", () => {
    const closed = interval({ endedAt: "2026-07-25T10:12:00.000Z", isOpen: false, durationMs: 720000 })
    expect(evaluateDurationInState(rule, ctx([closed]))).toHaveLength(1)
  })

  it("emite una detección por cada intervalo que supera el umbral", () => {
    const detections = evaluateDurationInState(
      rule,
      ctx([interval(), interval({ entityId: "EVC-02" })]),
    )
    expect(detections.map((d) => d.entityId)).toEqual(["EVC-01", "EVC-02"])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run engine/rules/duration-in-state.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar**

`engine/rules/duration-in-state.ts`:

```ts
import type { Detection, EvalContext, Rule } from "../schema.js"

type DurationInStateRule = Extract<Rule, { type: "duration_in_state" }>

export function evaluateDurationInState(
  rule: DurationInStateRule,
  ctx: EvalContext,
): Detection[] {
  return ctx.intervals
    .filter((i) => i.state === rule.state && i.durationMs > rule.thresholdMs)
    .map((i) => ({
      ruleId: rule.id,
      entityId: i.entityId,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: {
        state: i.state,
        durationMs: i.durationMs,
        thresholdMs: rule.thresholdMs,
        startedAt: i.startedAt,
      },
      dedupKey: `${rule.id}:${i.entityId}:${i.startedAt}`,
      cooldownKey: `${rule.id}:${i.entityId}`,
    }))
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run engine/rules/duration-in-state.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/rules/duration-in-state.ts engine/rules/duration-in-state.test.ts
git commit -m "feat(engine): regla duration_in_state"
```

---

### Task 5: Regla `absence_of_events`

**Files:**
- Create: `engine/rules/absence-of-events.ts`
- Test: `engine/rules/absence-of-events.test.ts`

**Interfaces:**
- Consumes: `EvalContext`, `Detection`, `Rule`.
- Produces: `evaluateAbsenceOfEvents(rule, ctx): Detection[]`.
- El roster de entidades se deriva de `ctx.events`. Dispara si la última marca de tiempo de la entidad es más vieja que `windowMs` respecto de `ctx.now`.
- `dedupKey` = `` `${rule.id}:${entityId}:${lastSeenAt}` `` — así una entidad que sigue callada no re-dispara hasta que se reporte y vuelva a callarse.
- `evidence` = `{ lastSeenAt, silentForMs, windowMs }`.

- [ ] **Step 1: Escribir el test que falla**

`engine/rules/absence-of-events.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { evaluateAbsenceOfEvents } from "./absence-of-events.js"
import type { EvalContext, NormalizedEvent, Rule } from "../schema.js"

const rule = {
  id: "offline",
  type: "absence_of_events",
  windowMs: 300000,
  severity: "high",
  description: "Estación sin heartbeat",
} as const satisfies Extract<Rule, { type: "absence_of_events" }>

const ev = (entityId: string, iso: string): NormalizedEvent => ({
  entityId,
  timestamp: iso,
  state: "Available",
  metadata: {},
})

const ctx = (events: NormalizedEvent[]): EvalContext => ({
  intervals: [],
  events,
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateAbsenceOfEvents", () => {
  it("dispara cuando la entidad lleva más que la ventana sin reportar", () => {
    const [detection] = evaluateAbsenceOfEvents(rule, ctx([ev("EVC-01", "2026-07-25T10:20:00.000Z")]))
    expect(detection).toMatchObject({
      entityId: "EVC-01",
      dedupKey: "offline:EVC-01:2026-07-25T10:20:00.000Z",
      cooldownKey: "offline:EVC-01",
    })
    expect(detection!.evidence).toMatchObject({ silentForMs: 600000, windowMs: 300000 })
  })

  it("no dispara si reportó dentro de la ventana", () => {
    expect(evaluateAbsenceOfEvents(rule, ctx([ev("EVC-01", "2026-07-25T10:28:00.000Z")]))).toEqual([])
  })

  it("usa el evento más reciente de cada entidad", () => {
    const result = evaluateAbsenceOfEvents(
      rule,
      ctx([ev("EVC-01", "2026-07-25T10:00:00.000Z"), ev("EVC-01", "2026-07-25T10:29:00.000Z")]),
    )
    expect(result).toEqual([])
  })

  it("evalúa cada entidad por separado", () => {
    const result = evaluateAbsenceOfEvents(
      rule,
      ctx([ev("EVC-01", "2026-07-25T10:00:00.000Z"), ev("EVC-02", "2026-07-25T10:29:00.000Z")]),
    )
    expect(result.map((d) => d.entityId)).toEqual(["EVC-01"])
  })

  it("no dispara sin eventos", () => {
    expect(evaluateAbsenceOfEvents(rule, ctx([]))).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run engine/rules/absence-of-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`engine/rules/absence-of-events.ts`:

```ts
import type { Detection, EvalContext, Rule } from "../schema.js"

type AbsenceRule = Extract<Rule, { type: "absence_of_events" }>

export function evaluateAbsenceOfEvents(rule: AbsenceRule, ctx: EvalContext): Detection[] {
  const lastSeen = new Map<string, string>()
  for (const event of ctx.events) {
    const current = lastSeen.get(event.entityId)
    if (!current || Date.parse(event.timestamp) > Date.parse(current)) {
      lastSeen.set(event.entityId, event.timestamp)
    }
  }

  const detections: Detection[] = []
  for (const [entityId, lastSeenAt] of lastSeen) {
    const silentForMs = ctx.now.getTime() - Date.parse(lastSeenAt)
    if (silentForMs <= rule.windowMs) continue
    detections.push({
      ruleId: rule.id,
      entityId,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: { lastSeenAt, silentForMs, windowMs: rule.windowMs },
      dedupKey: `${rule.id}:${entityId}:${lastSeenAt}`,
      cooldownKey: `${rule.id}:${entityId}`,
    })
  }
  return detections
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run engine/rules/absence-of-events.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/rules/absence-of-events.ts engine/rules/absence-of-events.test.ts
git commit -m "feat(engine): regla absence_of_events"
```

---

### Task 6: Regla `frequency_in_window`

**Files:**
- Create: `engine/rules/frequency-in-window.ts`
- Test: `engine/rules/frequency-in-window.test.ts`

**Interfaces:**
- Consumes: `EvalContext`, `Detection`, `Rule`.
- Produces: `evaluateFrequencyInWindow(rule, ctx): Detection[]`.
- Cuenta **intervalos que comenzaron** en `toState` dentro de `[now - windowMs, now]`. Agrupa por `entityId`, o por el campo de metadata que indique `groupBy`.
- Cuando hay `groupBy`, el `entityId` de la detección es el valor del grupo (ej. `"norte"`), no una entidad individual — es una detección sobre el grupo.
- Entradas cuyo `groupBy` no está presente en la metadata se ignoran.
- `dedupKey` = `` `${rule.id}:${group}:${latestStartedAt}` ``, donde `latestStartedAt` es el `startedAt` más reciente entre los intervalos contados para ese grupo. **Anclado al dato, no al reloj**: si estuviera anclado a la ventana (derivada de `ctx.now`), la clave cambiaría en cada tick de evaluación, el dedup no suprimiría nada y el `Map` del store crecería un entry por tick. Sus dos reglas hermanas anclan igual: `interval.startedAt` una, `lastSeenAt` la otra.
- `cooldownKey` = `` `${rule.id}:${group}` ``; `evidence` = `{ count, threshold, windowMs, groupBy }`.

- [ ] **Step 1: Escribir el test que falla**

`engine/rules/frequency-in-window.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { evaluateFrequencyInWindow } from "./frequency-in-window.js"
import type { EvalContext, Interval, Rule } from "../schema.js"

const rule = {
  id: "demand-spike",
  type: "frequency_in_window",
  toState: "Charging",
  windowMs: 900000,
  count: 3,
  severity: "low",
  description: "Pico de demanda",
} as const satisfies Extract<Rule, { type: "frequency_in_window" }>

const iv = (entityId: string, minute: number, state = "Charging", metadata = {}): Interval => ({
  entityId,
  state,
  startedAt: `2026-07-25T10:${String(minute).padStart(2, "0")}:00.000Z`,
  endedAt: null,
  durationMs: 0,
  isOpen: true,
  metadata,
})

const ctx = (intervals: Interval[]): EvalContext => ({
  intervals,
  events: [],
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateFrequencyInWindow", () => {
  it("dispara cuando se alcanza el conteo dentro de la ventana", () => {
    const [detection] = evaluateFrequencyInWindow(
      rule,
      ctx([iv("A", 20), iv("A", 22), iv("A", 25)]),
    )
    expect(detection).toMatchObject({ entityId: "A", ruleId: "demand-spike" })
    expect(detection!.evidence).toMatchObject({ count: 3, threshold: 3 })
  })

  it("no dispara por debajo del conteo", () => {
    expect(evaluateFrequencyInWindow(rule, ctx([iv("A", 20), iv("A", 22)]))).toEqual([])
  })

  it("descarta lo que quedó fuera de la ventana", () => {
    // 10:10 está a 20 min de now; la ventana es de 15 min.
    expect(
      evaluateFrequencyInWindow(rule, ctx([iv("A", 10), iv("A", 22), iv("A", 25)])),
    ).toEqual([])
  })

  it("ignora transiciones a otro estado", () => {
    expect(
      evaluateFrequencyInWindow(rule, ctx([iv("A", 20), iv("A", 22), iv("A", 25, "Faulted")])),
    ).toEqual([])
  })

  it("agrupa por un campo de metadata cuando hay groupBy", () => {
    const grouped = { ...rule, groupBy: "zone" } as const
    const [detection] = evaluateFrequencyInWindow(
      grouped,
      ctx([
        iv("A", 20, "Charging", { zone: "norte" }),
        iv("B", 22, "Charging", { zone: "norte" }),
        iv("C", 25, "Charging", { zone: "norte" }),
        iv("D", 26, "Charging", { zone: "sur" }),
      ]),
    )
    expect(detection).toMatchObject({ entityId: "norte" })
    expect(detection!.evidence).toMatchObject({ count: 3, groupBy: "zone" })
  })

  it("ignora entradas sin el campo de groupBy", () => {
    const grouped = { ...rule, groupBy: "zone" } as const
    expect(
      evaluateFrequencyInWindow(grouped, ctx([iv("A", 20), iv("B", 22), iv("C", 25)])),
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run engine/rules/frequency-in-window.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`engine/rules/frequency-in-window.ts`:

```ts
import type { Detection, EvalContext, Rule } from "../schema.js"

type FrequencyRule = Extract<Rule, { type: "frequency_in_window" }>

export function evaluateFrequencyInWindow(rule: FrequencyRule, ctx: EvalContext): Detection[] {
  const windowStart = ctx.now.getTime() - rule.windowMs

  // Se guarda el startedAt más reciente por grupo, no solo el conteo: es lo que
  // ancla el dedupKey al dato en vez de al reloj. La comparación es explícita
  // para no depender de que ctx.intervals venga ordenado.
  const groups = new Map<string, { count: number; latestStartedAt: string }>()

  for (const interval of ctx.intervals) {
    if (interval.state !== rule.toState) continue
    if (Date.parse(interval.startedAt) < windowStart) continue

    let group: string
    if (rule.groupBy) {
      const raw = interval.metadata[rule.groupBy]
      if (typeof raw !== "string") continue
      group = raw
    } else {
      group = interval.entityId
    }

    const bucket = groups.get(group)
    if (!bucket) {
      groups.set(group, { count: 1, latestStartedAt: interval.startedAt })
    } else {
      bucket.count += 1
      if (Date.parse(interval.startedAt) > Date.parse(bucket.latestStartedAt)) {
        bucket.latestStartedAt = interval.startedAt
      }
    }
  }

  const detections: Detection[] = []
  for (const [group, { count, latestStartedAt }] of groups) {
    if (count < rule.count) continue
    detections.push({
      ruleId: rule.id,
      entityId: group,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: {
        count,
        threshold: rule.count,
        windowMs: rule.windowMs,
        groupBy: rule.groupBy ?? null,
      },
      dedupKey: `${rule.id}:${group}:${latestStartedAt}`,
      cooldownKey: `${rule.id}:${group}`,
    })
  }
  return detections
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run engine/rules/frequency-in-window.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/rules/frequency-in-window.ts engine/rules/frequency-in-window.test.ts
git commit -m "feat(engine): regla frequency_in_window"
```

---

### Task 7: Regla `duration_vs_baseline`, registry y detector

Cierra el motor: la cuarta regla, el registry que mapea `type → evaluator`, y el detector con supresión por dedup y cooldown. Termina con el test que verifica la tesis del proyecto.

**Files:**
- Create: `engine/rules/duration-vs-baseline.ts`, `engine/rules/index.ts`, `engine/detector.ts`, `adapters/store/memory.ts`
- Test: `engine/rules/duration-vs-baseline.test.ts`, `engine/detector.test.ts`, `engine/two-domains.test.ts`

**Interfaces:**
- Produces:
  - `evaluateDurationVsBaseline(rule, ctx): Detection[]` — el umbral es el percentil `percentile` de las duraciones de los intervalos **cerrados** de ese estado **para esa misma entidad**. Con menos de `minSamples` cerrados, no dispara. Evalúa solo el intervalo abierto de cada entidad. Percentil por *nearest-rank* sobre la lista ascendente: `índice = ceil(p/100 × n) − 1`.
  - `detect(events: NormalizedEvent[], config: DomainConfig, now: Date): Detection[]` — puro, sin supresión.
  - `interface StateStore { lastFiredAt(key: string): Date | null; markFired(key: string, at: Date): void }` — **se declara en `engine/schema.ts`**, no en el adapter. El motor define la interfaz que necesita; el adapter la implementa. Al revés, `/engine` dependería de `/adapters`.
  - `createMemoryStore(): StateStore` en `adapters/store/memory.ts`.
  - `suppress(detections: Detection[], store: StateStore, config: DomainConfig, now: Date): Detection[]` — descarta las ya disparadas por `dedupKey` y las que estén dentro de `cooldownMs` por `cooldownKey`; marca en el store las que deja pasar.

- [ ] **Step 1: Escribir el test de `duration_vs_baseline`**

`engine/rules/duration-vs-baseline.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { evaluateDurationVsBaseline } from "./duration-vs-baseline.js"
import type { EvalContext, Interval, Rule } from "../schema.js"

const rule = {
  id: "long-session",
  type: "duration_vs_baseline",
  state: "Charging",
  percentile: 95,
  minSamples: 3,
  severity: "medium",
  description: "Sesión de carga anómala",
} as const satisfies Extract<Rule, { type: "duration_vs_baseline" }>

const closed = (entityId: string, durationMs: number, minute: number): Interval => ({
  entityId,
  state: "Charging",
  startedAt: `2026-07-25T09:${String(minute).padStart(2, "0")}:00.000Z`,
  endedAt: `2026-07-25T09:59:00.000Z`,
  durationMs,
  isOpen: false,
  metadata: {},
})

const open = (entityId: string, durationMs: number): Interval => ({
  entityId,
  state: "Charging",
  startedAt: "2026-07-25T10:00:00.000Z",
  endedAt: null,
  durationMs,
  isOpen: true,
  metadata: {},
})

const ctx = (intervals: Interval[]): EvalContext => ({
  intervals,
  events: [],
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateDurationVsBaseline", () => {
  it("no dispara con menos muestras que minSamples", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([closed("A", 1000, 1), closed("A", 2000, 2), open("A", 999999)]),
    )
    expect(result).toEqual([])
  })

  it("dispara cuando el intervalo abierto supera el percentil del histórico", () => {
    const [detection] = evaluateDurationVsBaseline(
      rule,
      ctx([closed("A", 1000, 1), closed("A", 2000, 2), closed("A", 3000, 3), open("A", 9000)]),
    )
    expect(detection).toMatchObject({ entityId: "A", ruleId: "long-session" })
    expect(detection!.evidence).toMatchObject({ durationMs: 9000, baselineMs: 3000 })
  })

  it("no dispara si el abierto está dentro del baseline", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([closed("A", 1000, 1), closed("A", 2000, 2), closed("A", 3000, 3), open("A", 2500)]),
    )
    expect(result).toEqual([])
  })

  it("calcula el baseline por entidad, no global", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([
        closed("A", 1000, 1),
        closed("A", 1000, 2),
        closed("A", 1000, 3),
        closed("B", 90000, 1),
        closed("B", 90000, 2),
        closed("B", 90000, 3),
        open("A", 5000),
        open("B", 5000),
      ]),
    )
    expect(result.map((d) => d.entityId)).toEqual(["A"])
  })

  it("ignora intervalos de otro estado", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([{ ...closed("A", 1000, 1), state: "Faulted" }, open("A", 999999)]),
    )
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run engine/rules/duration-vs-baseline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar la regla**

`engine/rules/duration-vs-baseline.ts`:

```ts
import type { Detection, EvalContext, Interval, Rule } from "../schema.js"

type BaselineRule = Extract<Rule, { type: "duration_vs_baseline" }>

/** Percentil por nearest-rank sobre una lista ascendente no vacía. */
function percentile(sortedAsc: number[], p: number): number {
  const index = Math.ceil((p / 100) * sortedAsc.length) - 1
  return sortedAsc[Math.min(Math.max(index, 0), sortedAsc.length - 1)]!
}

export function evaluateDurationVsBaseline(rule: BaselineRule, ctx: EvalContext): Detection[] {
  const byEntity = new Map<string, { closed: number[]; open: Interval | null }>()

  for (const interval of ctx.intervals) {
    if (interval.state !== rule.state) continue
    const bucket = byEntity.get(interval.entityId) ?? { closed: [], open: null }
    if (interval.isOpen) bucket.open = interval
    else bucket.closed.push(interval.durationMs)
    byEntity.set(interval.entityId, bucket)
  }

  const detections: Detection[] = []

  for (const [entityId, { closed, open }] of byEntity) {
    if (!open) continue
    if (closed.length < rule.minSamples) continue

    const baselineMs = percentile([...closed].sort((a, b) => a - b), rule.percentile)
    if (open.durationMs <= baselineMs) continue

    detections.push({
      ruleId: rule.id,
      entityId,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: {
        state: rule.state,
        durationMs: open.durationMs,
        baselineMs,
        percentile: rule.percentile,
        samples: closed.length,
        startedAt: open.startedAt,
      },
      dedupKey: `${rule.id}:${entityId}:${open.startedAt}`,
      cooldownKey: `${rule.id}:${entityId}`,
    })
  }

  return detections
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run engine/rules/duration-vs-baseline.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Escribir el registry**

`engine/rules/index.ts`:

```ts
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
```

- [ ] **Step 6: Escribir el test del detector y la supresión**

`engine/detector.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { detect, suppress } from "./detector.js"
import { createMemoryStore } from "../adapters/store/memory.js"
import type { DomainConfig, NormalizedEvent } from "./schema.js"

const config: DomainConfig = {
  domain: "test",
  displayName: "Test",
  entity: { singular: "cosa", plural: "cosas" },
  states: ["Ok", "Bad"],
  context: "Dominio de prueba.",
  rules: [
    {
      id: "bad-stuck",
      type: "duration_in_state",
      state: "Bad",
      thresholdMs: 600000,
      severity: "high",
      description: "Atascado en Bad",
    },
  ],
  actions: [{ id: "ignore", type: "noop", description: "No hacer nada", config: {} }],
  cooldownMs: 900000,
}

const events: NormalizedEvent[] = [
  { entityId: "X", timestamp: "2026-07-25T10:00:00.000Z", state: "Bad", metadata: {} },
]
const NOW = new Date("2026-07-25T10:30:00.000Z")

describe("detect", () => {
  it("corre todas las reglas del config", () => {
    expect(detect(events, config, NOW)).toHaveLength(1)
  })

  it("es puro: la misma entrada da el mismo resultado", () => {
    expect(detect(events, config, NOW)).toEqual(detect(events, config, NOW))
  })

  it("no detecta nada sin reglas", () => {
    expect(detect(events, { ...config, rules: [] }, NOW)).toEqual([])
  })
})

describe("suppress", () => {
  it("deja pasar una detección nueva", () => {
    const store = createMemoryStore()
    expect(suppress(detect(events, config, NOW), store, config, NOW)).toHaveLength(1)
  })

  it("descarta el segundo disparo del mismo intervalo", () => {
    const store = createMemoryStore()
    suppress(detect(events, config, NOW), store, config, NOW)
    const later = new Date("2026-07-25T10:31:00.000Z")
    expect(suppress(detect(events, config, later), store, config, later)).toEqual([])
  })

  it("respeta el cooldown ante un intervalo nuevo de la misma entidad y regla", () => {
    const store = createMemoryStore()
    suppress(detect(events, config, NOW), store, config, NOW)

    // Nuevo intervalo Bad (pasó por Ok en el medio) 5 min después: dentro del cooldown de 15 min.
    const reincidencia: NormalizedEvent[] = [
      ...events,
      { entityId: "X", timestamp: "2026-07-25T10:31:00.000Z", state: "Ok", metadata: {} },
      { entityId: "X", timestamp: "2026-07-25T10:32:00.000Z", state: "Bad", metadata: {} },
    ]
    const later = new Date("2026-07-25T10:43:00.000Z")
    expect(suppress(detect(reincidencia, config, later), store, config, later)).toEqual([])
  })

  it("deja pasar de nuevo una vez vencido el cooldown", () => {
    const store = createMemoryStore()
    suppress(detect(events, config, NOW), store, config, NOW)

    const reincidencia: NormalizedEvent[] = [
      ...events,
      { entityId: "X", timestamp: "2026-07-25T10:31:00.000Z", state: "Ok", metadata: {} },
      { entityId: "X", timestamp: "2026-07-25T10:32:00.000Z", state: "Bad", metadata: {} },
    ]
    const muchoDespues = new Date("2026-07-25T11:00:00.000Z")
    expect(suppress(detect(reincidencia, config, muchoDespues), store, config, muchoDespues)).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Correr y verificar que falla**

Run: `npx vitest run engine/detector.test.ts`
Expected: FAIL — no existen `engine/detector.ts` ni `adapters/store/memory.ts`.

- [ ] **Step 8: Declarar `StateStore` en el schema e implementar el store**

Agregar al final de `engine/schema.ts`:

```ts
/**
 * Lo que el motor necesita recordar entre corridas para no repetir alertas.
 * La interfaz vive acá y no en el adapter: el motor declara lo que necesita,
 * el adapter lo implementa. Al revés, /engine dependería de /adapters.
 */
export interface StateStore {
  lastFiredAt(key: string): Date | null
  markFired(key: string, at: Date): void
}
```

`adapters/store/memory.ts`:

```ts
import type { StateStore } from "../../engine/schema.js"

export function createMemoryStore(): StateStore {
  const fired = new Map<string, Date>()
  return {
    lastFiredAt: (key) => fired.get(key) ?? null,
    markFired: (key, at) => {
      fired.set(key, at)
    },
  }
}
```

- [ ] **Step 9: Implementar el detector**

`engine/detector.ts`:

```ts
import { toIntervals } from "./intervals.js"
import { evaluateRule } from "./rules/index.js"
import type {
  Detection,
  DomainConfig,
  EvalContext,
  NormalizedEvent,
  StateStore,
} from "./schema.js"

export function detect(
  events: NormalizedEvent[],
  config: DomainConfig,
  now: Date,
): Detection[] {
  const ctx: EvalContext = { intervals: toIntervals(events, now), events, now }
  return config.rules.flatMap((rule) => evaluateRule(rule, ctx))
}

export function suppress(
  detections: Detection[],
  store: StateStore,
  config: DomainConfig,
  now: Date,
): Detection[] {
  const passed: Detection[] = []

  for (const detection of detections) {
    if (store.lastFiredAt(detection.dedupKey)) continue

    const lastForEntity = store.lastFiredAt(detection.cooldownKey)
    if (lastForEntity && now.getTime() - lastForEntity.getTime() < config.cooldownMs) continue

    store.markFired(detection.dedupKey, now)
    store.markFired(detection.cooldownKey, now)
    passed.push(detection)
  }

  return passed
}
```

- [ ] **Step 10: Correr y verificar que pasa**

Run: `npx vitest run engine/detector.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 11: Escribir los dos configs**

`configs/volt.json`:

```json
{
  "domain": "volt",
  "displayName": "VOLT — Estaciones de carga",
  "entity": { "singular": "estación", "plural": "estaciones" },
  "states": ["Available", "Occupied", "Charging", "Faulted", "Reserved", "Unavailable"],
  "context": "Red de carga de vehículos eléctricos operada por VOLT en Colombia. El equipo de operaciones responde 24/7 y despacha técnicos a estaciones en falla. Una estación caída es ingreso perdido y un conductor varado.",
  "rules": [
    { "id": "faulted-stuck", "type": "duration_in_state", "state": "Faulted", "thresholdMs": 600000, "severity": "high", "description": "Estación atascada en falla" },
    { "id": "long-session", "type": "duration_vs_baseline", "state": "Charging", "percentile": 95, "minSamples": 5, "severity": "medium", "description": "Sesión de carga mucho más larga que lo normal para esta estación" },
    { "id": "offline", "type": "absence_of_events", "windowMs": 300000, "severity": "high", "description": "Estación sin heartbeat" },
    { "id": "demand-spike", "type": "frequency_in_window", "toState": "Charging", "windowMs": 900000, "count": 4, "groupBy": "zone", "severity": "low", "description": "Pico de demanda concentrado en una zona" }
  ],
  "actions": [
    { "id": "alert-ops", "type": "discord", "description": "Alerta al equipo de operaciones en su canal de guardia", "config": { "webhookUrl": "env:DISCORD_OPS_WEBHOOK" } },
    { "id": "create-ticket", "type": "github_issue", "description": "Crea un ticket de mantenimiento para que un técnico visite la estación", "config": { "repo": "env:GITHUB_REPO", "token": "env:GITHUB_TOKEN" } },
    { "id": "ignore", "type": "noop", "description": "La situación no amerita ninguna acción" }
  ],
  "cooldownMs": 900000
}
```

`configs/restaurant.json`:

```json
{
  "domain": "restaurant",
  "displayName": "Mesas — Reservas de restaurante",
  "entity": { "singular": "mesa", "plural": "mesas" },
  "states": ["Libre", "Reservada", "Ocupada"],
  "context": "Restaurante de 12 mesas con reservas. El dueño atiende el salón y no mira el sistema. Una mesa reservada que no llega es plata que se pierde en hora pico; una mesa ocupada mucho más de lo normal puede necesitar atención.",
  "rules": [
    { "id": "no-show", "type": "duration_in_state", "state": "Reservada", "thresholdMs": 900000, "severity": "medium", "description": "Reserva sin check-in, riesgo de no-show" },
    { "id": "sobremesa", "type": "duration_vs_baseline", "state": "Ocupada", "percentile": 90, "minSamples": 5, "severity": "low", "description": "Mesa ocupada mucho más tiempo que el promedio" },
    { "id": "rush", "type": "frequency_in_window", "toState": "Ocupada", "windowMs": 900000, "count": 4, "severity": "low", "description": "Ráfaga de mesas ocupándose a la vez" }
  ],
  "actions": [
    { "id": "avisar-dueno", "type": "ntfy", "description": "Notificación al celular del dueño del restaurante", "config": { "topic": "env:NTFY_TOPIC" } },
    { "id": "liberar-reserva", "type": "state_mutation", "description": "Libera la reserva automáticamente para que la mesa vuelva a estar disponible", "config": { "toState": "Libre" } },
    { "id": "ignore", "type": "noop", "description": "La situación no amerita ninguna acción" }
  ],
  "cooldownMs": 600000
}
```

- [ ] **Step 12: Escribir el test de dos dominios — la tesis**

`engine/two-domains.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { detect } from "./detector.js"
import { normalize } from "./normalizer.js"
import { DomainConfigSchema, type NormalizedEvent } from "./schema.js"
import voltRaw from "../configs/volt.json" with { type: "json" }
import restaurantRaw from "../configs/restaurant.json" with { type: "json" }

const NOW = new Date("2026-07-25T20:00:00.000Z")

describe("el mismo motor sobre dos dominios distintos", () => {
  it("los dos configs son válidos contra el mismo schema", () => {
    expect(() => DomainConfigSchema.parse(voltRaw)).not.toThrow()
    expect(() => DomainConfigSchema.parse(restaurantRaw)).not.toThrow()
  })

  it("detecta una estación atascada en falla usando la config de VOLT", () => {
    const config = DomainConfigSchema.parse(voltRaw)
    const events = normalize([
      { entityId: "EVC-04", timestamp: "2026-07-25T19:30:00.000Z", state: "Available", metadata: { zone: "norte" } },
      { entityId: "EVC-04", timestamp: "2026-07-25T19:45:00.000Z", state: "Faulted", metadata: { zone: "norte" } },
    ] satisfies unknown[])

    const ids = detect(events, config, NOW).map((d) => d.ruleId)
    expect(ids).toContain("faulted-stuck")
  })

  it("detecta un no-show usando la config del restaurante — misma función", () => {
    const config = DomainConfigSchema.parse(restaurantRaw)
    const events = normalize([
      { entityId: "mesa-7", timestamp: "2026-07-25T19:00:00.000Z", state: "Libre" },
      { entityId: "mesa-7", timestamp: "2026-07-25T19:40:00.000Z", state: "Reservada" },
    ] satisfies unknown[])

    const ids = detect(events, config, NOW).map((d) => d.ruleId)
    expect(ids).toContain("no-show")
  })

  it("cada config solo dispara sus propias reglas", () => {
    const volt = DomainConfigSchema.parse(voltRaw)
    const restaurant = DomainConfigSchema.parse(restaurantRaw)
    const events: NormalizedEvent[] = normalize([
      { entityId: "mesa-7", timestamp: "2026-07-25T19:40:00.000Z", state: "Reservada" },
    ] satisfies unknown[])

    // El estado "Reservada" existe en ambos dominios, pero solo el restaurante
    // tiene una regla que lo vigile.
    expect(detect(events, restaurant, NOW).map((d) => d.ruleId)).toContain("no-show")
    expect(detect(events, volt, NOW).filter((d) => d.ruleId === "no-show")).toEqual([])
  })
})
```

- [ ] **Step 13: Correr toda la suite**

Run: `npm test`
Expected: PASS en todos los archivos. Este es el punto donde el motor está terminado y la tesis es verificable.

- [ ] **Step 14: Commit**

```bash
git add engine adapters/store configs
git commit -m "feat(engine): baseline, detector con supresión, y test de dos dominios"
```

---

## Fase 2 — Simulador y decisor (Tasks 8-9)

### Task 8: Simulador OCPP determinístico

Sin esto no hay demo: el simulador es la fuente de eventos, y el determinismo es lo que hace grabable el video.

**Files:**
- Create: `simulators/rng.ts`, `simulators/volt-ocpp.ts`
- Test: `simulators/volt-ocpp.test.ts`

**Interfaces:**
- Produces:
  - `createRng(seed: number): () => number` — PRNG mulberry32, devuelve floats en `[0, 1)`.
  - `simulateVolt(opts: { seed: number; stations: number; from: Date; durationMs: number; forceIncident?: boolean }): NormalizedEvent[]` — eventos ordenados por timestamp. Con `forceIncident: true` garantiza al menos una estación que entra en `Faulted` y se queda ahí más de 10 minutos antes del final.

- [ ] **Step 1: Escribir el test que falla**

`simulators/volt-ocpp.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createRng } from "./rng.js"
import { simulateVolt } from "./volt-ocpp.js"
import { detect } from "../engine/detector.js"
import { DomainConfigSchema } from "../engine/schema.js"
import voltRaw from "../configs/volt.json" with { type: "json" }

const FROM = new Date("2026-07-25T18:00:00.000Z")
const DURATION = 2 * 60 * 60 * 1000

describe("createRng", () => {
  it("es determinístico para el mismo seed", () => {
    const a = createRng(42)
    const b = createRng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it("difiere entre seeds", () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })

  it("devuelve valores en [0, 1)", () => {
    const rng = createRng(7)
    for (let i = 0; i < 100; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe("simulateVolt", () => {
  const opts = { seed: 42, stations: 5, from: FROM, durationMs: DURATION }

  it("es determinístico para el mismo seed", () => {
    expect(simulateVolt(opts)).toEqual(simulateVolt(opts))
  })

  it("emite eventos ordenados por timestamp", () => {
    const times = simulateVolt(opts).map((e) => Date.parse(e.timestamp))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it("usa solo estados declarados en la config de VOLT", () => {
    const config = DomainConfigSchema.parse(voltRaw)
    for (const event of simulateVolt(opts)) {
      expect(config.states).toContain(event.state)
    }
  })

  it("marca cada estación con una zona en la metadata", () => {
    for (const event of simulateVolt(opts)) {
      expect(typeof event.metadata.zone).toBe("string")
    }
  })

  it("con forceIncident garantiza una detección de faulted-stuck", () => {
    const config = DomainConfigSchema.parse(voltRaw)
    const now = new Date(FROM.getTime() + DURATION)
    const events = simulateVolt({ ...opts, forceIncident: true })
    const ids = detect(events, config, now).map((d) => d.ruleId)
    expect(ids).toContain("faulted-stuck")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run simulators/volt-ocpp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el PRNG**

`simulators/rng.ts`:

```ts
/** mulberry32 — PRNG pequeño y determinístico. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

- [ ] **Step 4: Implementar el simulador**

`simulators/volt-ocpp.ts`:

```ts
import type { NormalizedEvent } from "../engine/schema.js"
import { createRng } from "./rng.js"

const ZONES = ["norte", "centro", "sur"] as const
const CYCLE = ["Available", "Occupied", "Charging", "Available"] as const

export interface SimulateVoltOptions {
  seed: number
  stations: number
  from: Date
  durationMs: number
  forceIncident?: boolean
}

export function simulateVolt(opts: SimulateVoltOptions): NormalizedEvent[] {
  const rng = createRng(opts.seed)
  const events: NormalizedEvent[] = []
  const end = opts.from.getTime() + opts.durationMs

  for (let i = 0; i < opts.stations; i++) {
    const entityId = `EVC-${String(i + 1).padStart(2, "0")}`
    const zone = ZONES[Math.floor(rng() * ZONES.length)]!
    const metadata = { zone }

    let cursor = opts.from.getTime() + Math.floor(rng() * 5 * 60_000)
    let step = 0

    while (cursor < end) {
      const state = CYCLE[step % CYCLE.length]!
      events.push({
        entityId,
        entityType: "station",
        timestamp: new Date(cursor).toISOString(),
        state,
        metadata,
      })
      cursor += 5 * 60_000 + Math.floor(rng() * 20 * 60_000)
      step++
    }
  }

  if (opts.forceIncident) {
    // Una estación entra en Faulted 30 min antes del final y no sale.
    const faultAt = end - 30 * 60_000
    const victim = "EVC-01"
    const zone = events.find((e) => e.entityId === victim)?.metadata.zone ?? ZONES[0]
    const kept = events.filter(
      (e) => !(e.entityId === victim && Date.parse(e.timestamp) >= faultAt),
    )
    kept.push({
      entityId: victim,
      entityType: "station",
      timestamp: new Date(faultAt).toISOString(),
      state: "Faulted",
      metadata: { zone },
    })
    events.length = 0
    events.push(...kept)
  }

  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run simulators/volt-ocpp.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add simulators
git commit -m "feat(sim): simulador OCPP determinístico con incidente forzable"
```

---

### Task 9: Decisor con Claude

**Files:**
- Create: `adapters/decider/claude.ts`, `adapters/decider/prompt.ts`
- Test: `adapters/decider/prompt.test.ts`

**Interfaces:**
- Consumes: `Detection`, `DomainConfig`, `Decision` de `engine/schema.ts`.
- Produces:
  - `buildTools(config: DomainConfig)` — una tool por acción, con `strict: true`, `additionalProperties: false` y `required: ["message", "reason"]`.
  - `buildPrompt(detection, config)` — `{ system, user }`, donde `system` incluye `config.context` y el naming de la entidad.
  - `decide(detection: Detection, config: DomainConfig, client: Anthropic): Promise<Decision>` — llama a Claude y devuelve la acción elegida. Si Claude no emite ningún bloque `tool_use`, lanza `DeciderError`.

La lógica pura (`buildTools`, `buildPrompt`) se testea; la llamada de red no.

- [ ] **Step 1: Escribir el test que falla**

`adapters/decider/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildPrompt, buildTools } from "./prompt.js"
import { DomainConfigSchema, type Detection } from "../../engine/schema.js"
import voltRaw from "../../configs/volt.json" with { type: "json" }

const config = DomainConfigSchema.parse(voltRaw)

const detection: Detection = {
  ruleId: "faulted-stuck",
  entityId: "EVC-04",
  detectedAt: "2026-07-25T20:00:00.000Z",
  severity: "high",
  evidence: { state: "Faulted", durationMs: 720000, thresholdMs: 600000 },
  dedupKey: "faulted-stuck:EVC-04:2026-07-25T19:48:00.000Z",
  cooldownKey: "faulted-stuck:EVC-04",
}

describe("buildTools", () => {
  it("crea una tool por cada acción del config", () => {
    const tools = buildTools(config)
    expect(tools.map((t) => t.name)).toEqual(config.actions.map((a) => a.id))
  })

  it("usa la description del config como description de la tool", () => {
    const tool = buildTools(config).find((t) => t.name === "alert-ops")!
    expect(tool.description).toBe(
      config.actions.find((a) => a.id === "alert-ops")!.description,
    )
  })

  it("marca las tools como strict y cierra el schema", () => {
    for (const tool of buildTools(config)) {
      expect(tool.strict).toBe(true)
      expect(tool.input_schema.additionalProperties).toBe(false)
      expect(tool.input_schema.required).toEqual(["message", "reason"])
    }
  })

  it("no filtra la config de las acciones en las tools", () => {
    const serialized = JSON.stringify(buildTools(config))
    expect(serialized).not.toContain("env:")
    expect(serialized).not.toContain("webhookUrl")
  })
})

describe("buildPrompt", () => {
  it("incluye el contexto del dominio en el system", () => {
    expect(buildPrompt(detection, config).system).toContain(config.context)
  })

  it("usa el naming de la entidad del config", () => {
    expect(buildPrompt(detection, config).system).toContain("estación")
  })

  it("incluye la descripción de la regla y la evidencia en el user", () => {
    const { user } = buildPrompt(detection, config)
    expect(user).toContain("Estación atascada en falla")
    expect(user).toContain("EVC-04")
    expect(user).toContain("720000")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run adapters/decider/prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el prompt y las tools**

`adapters/decider/prompt.ts`:

```ts
import type { Detection, DomainConfig } from "../../engine/schema.js"

export interface DeciderTool {
  name: string
  description: string
  strict: true
  input_schema: {
    type: "object"
    properties: Record<string, { type: "string"; description: string }>
    required: ["message", "reason"]
    additionalProperties: false
  }
}

export function buildTools(config: DomainConfig): DeciderTool[] {
  return config.actions.map((action) => ({
    name: action.id,
    description: action.description,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "El texto que le llega a la persona. Escribilo en el tono del dominio.",
        },
        reason: {
          type: "string",
          description: "Por qué elegiste esta acción. Una frase, para el log.",
        },
      },
      required: ["message", "reason"],
      additionalProperties: false,
    },
  }))
}

export function buildPrompt(
  detection: Detection,
  config: DomainConfig,
): { system: string; user: string } {
  const rule = config.rules.find((r) => r.id === detection.ruleId)

  const system = [
    `Sos el agente de monitoreo de: ${config.displayName}.`,
    "",
    config.context,
    "",
    `Cada entidad que vigilás es una ${config.entity.singular}.`,
    "Recibís un patrón detectado y elegís exactamente una acción llamando a su tool.",
    "El mensaje que escribas lo lee una persona real de este dominio: usá su vocabulario,",
    "sé concreto con el dato que importa, y no expliques el sistema.",
    "Si la situación no amerita nada, es legítimo elegir la acción de no hacer nada.",
  ].join("\n")

  const user = [
    `Patrón detectado: ${rule?.description ?? detection.ruleId}`,
    `${config.entity.singular}: ${detection.entityId}`,
    `Severidad: ${detection.severity}`,
    `Momento: ${detection.detectedAt}`,
    "",
    "Evidencia:",
    JSON.stringify(detection.evidence, null, 2),
  ].join("\n")

  return { system, user }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run adapters/decider/prompt.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Implementar la llamada a Claude**

`adapters/decider/claude.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk"
import type { Decision, Detection, DomainConfig } from "../../engine/schema.js"
import { buildPrompt, buildTools } from "./prompt.js"

export class DeciderError extends Error {}

export async function decide(
  detection: Detection,
  config: DomainConfig,
  client: Anthropic,
): Promise<Decision> {
  const { system, user } = buildPrompt(detection, config)

  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    // Fast mode: la demo en vivo necesita que esto vuelva rápido.
    speed: "fast",
    betas: ["fast-mode-2026-02-01"],
    // NO desactivar el thinking: con thinking disabled, Opus 5 a veces escribe
    // la tool call como texto plano y la acción nunca se ejecuta, sin error.
    output_config: { effort: "low" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: buildTools(config),
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: user }],
  })

  for (const block of response.content) {
    if (block.type === "tool_use") {
      const input = block.input as { message?: unknown; reason?: unknown }
      if (typeof input.message !== "string" || typeof input.reason !== "string") {
        throw new DeciderError(`La tool ${block.name} devolvió un input con forma inesperada`)
      }
      return { actionId: block.name, reason: input.reason, message: input.message }
    }
  }

  throw new DeciderError(
    `Claude no eligió ninguna acción (stop_reason: ${response.stop_reason})`,
  )
}
```

- [ ] **Step 6: Verificar que compila y la suite sigue verde**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores de tipos; todos los tests pasan.

- [ ] **Step 7: Commit**

```bash
git add adapters/decider
git commit -m "feat(decider): tool use con Claude, tools generadas desde el config"
```

---

## Fase 3 — Executors y segundo dominio (Tasks 10-11)

### Task 10: Executors

**Files:**
- Create: `adapters/executors/resolve-env.ts`, `noop.ts`, `discord.ts`, `ntfy.ts`, `webhook.ts`, `github-issue.ts`, `state-mutation.ts`, `index.ts`
- Test: `adapters/executors/resolve-env.test.ts`, `adapters/executors/index.test.ts`

**Interfaces:**
- Produces:
  - `resolveEnv(config: Record<string, unknown>, env: Record<string, string | undefined>): Record<string, unknown>` — reemplaza los strings `env:NOMBRE` por su valor. Si la variable no existe, el valor queda `null`.
  - `interface ExecutionResult { ok: boolean; detail: string }`
  - `execute(action: Action, decision: Decision, detection: Detection, env, fetchImpl?): Promise<ExecutionResult>` — despacha por `action.type`. `fetchImpl` se inyecta para poder testear sin red.

- [ ] **Step 1: Escribir el test de `resolveEnv`**

`adapters/executors/resolve-env.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { resolveEnv } from "./resolve-env.js"

describe("resolveEnv", () => {
  it("reemplaza los strings con prefijo env:", () => {
    const result = resolveEnv({ webhookUrl: "env:HOOK" }, { HOOK: "https://ejemplo/abc" })
    expect(result.webhookUrl).toBe("https://ejemplo/abc")
  })

  it("deja null si la variable no existe", () => {
    expect(resolveEnv({ webhookUrl: "env:FALTANTE" }, {}).webhookUrl).toBeNull()
  })

  it("no toca los valores que no tienen el prefijo", () => {
    expect(resolveEnv({ toState: "Libre" }, {}).toState).toBe("Libre")
  })

  it("no toca valores que no son string", () => {
    expect(resolveEnv({ retries: 3 }, {}).retries).toBe(3)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run adapters/executors/resolve-env.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `resolveEnv`**

`adapters/executors/resolve-env.ts`:

```ts
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
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run adapters/executors/resolve-env.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Escribir el test del dispatch**

`adapters/executors/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { execute } from "./index.js"
import type { Action, Decision, Detection } from "../../engine/schema.js"

const decision: Decision = {
  actionId: "x",
  reason: "porque sí",
  message: "🔴 EVC-04 lleva 12 min en falla",
}

const detection: Detection = {
  ruleId: "faulted-stuck",
  entityId: "EVC-04",
  detectedAt: "2026-07-25T20:00:00.000Z",
  severity: "high",
  evidence: {},
  dedupKey: "a",
  cooldownKey: "b",
}

const action = (over: Partial<Action>): Action => ({
  id: "x",
  type: "noop",
  description: "d",
  config: {},
  ...over,
})

describe("execute", () => {
  it("noop no hace red y reporta ok", async () => {
    const fetchImpl = vi.fn()
    const result = await execute(action({ type: "noop" }), decision, detection, {}, fetchImpl)
    expect(result.ok).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("discord postea un embed al webhook resuelto", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    await execute(
      action({ type: "discord", config: { webhookUrl: "env:HOOK" } }),
      decision,
      detection,
      { HOOK: "https://discord/hook" },
      fetchImpl,
    )
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://discord/hook")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.embeds[0].description).toBe(decision.message)
  })

  it("falla explícitamente si el secreto no está en el entorno", async () => {
    const fetchImpl = vi.fn()
    const result = await execute(
      action({ type: "discord", config: { webhookUrl: "env:FALTANTE" } }),
      decision,
      detection,
      {},
      fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("FALTANTE")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("ntfy postea el mensaje como cuerpo plano al topic", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await execute(
      action({ type: "ntfy", config: { topic: "env:TOPIC" } }),
      decision,
      detection,
      { TOPIC: "centinela-demo" },
      fetchImpl,
    )
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://ntfy.sh/centinela-demo")
    expect((init as RequestInit).body).toBe(decision.message)
  })

  it("state_mutation no hace red y reporta el estado destino", async () => {
    const fetchImpl = vi.fn()
    const result = await execute(
      action({ type: "state_mutation", config: { toState: "Libre" } }),
      decision,
      detection,
      {},
      fetchImpl,
    )
    expect(result.ok).toBe(true)
    expect(result.detail).toContain("Libre")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("reporta no-ok cuando el POST falla", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const result = await execute(
      action({ type: "webhook", config: { url: "env:URL" } }),
      decision,
      detection,
      { URL: "https://ejemplo/hook" },
      fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("500")
  })
})
```

- [ ] **Step 6: Correr y verificar que falla**

Run: `npx vitest run adapters/executors/index.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implementar el dispatch**

`adapters/executors/index.ts`:

```ts
import type { Action, Decision, Detection } from "../../engine/schema.js"
import { resolveEnv } from "./resolve-env.js"

export interface ExecutionResult {
  ok: boolean
  detail: string
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>

const SEVERITY_COLOR: Record<string, number> = {
  low: 0x3498db,
  medium: 0xf1c40f,
  high: 0xe74c3c,
}

/** Devuelve el string resuelto, o el nombre de la variable faltante. */
function requireString(
  resolved: Record<string, unknown>,
  key: string,
  raw: Record<string, unknown>,
): { value: string } | { missing: string } {
  const value = resolved[key]
  if (typeof value === "string" && value.length > 0) return { value }
  const original = raw[key]
  const name = typeof original === "string" ? original.replace(/^env:/, "") : key
  return { missing: name }
}

export async function execute(
  action: Action,
  decision: Decision,
  detection: Detection,
  env: Record<string, string | undefined>,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<ExecutionResult> {
  const config = resolveEnv(action.config, env)

  const post = async (url: string, init: RequestInit): Promise<ExecutionResult> => {
    const response = await fetchImpl(url, init)
    return response.ok
      ? { ok: true, detail: `POST ${url} → ${response.status}` }
      : { ok: false, detail: `POST ${url} falló con ${response.status}` }
  }

  switch (action.type) {
    case "noop":
      return { ok: true, detail: "Sin acción — la situación no la ameritaba" }

    case "state_mutation": {
      const toState = typeof config.toState === "string" ? config.toState : "?"
      return { ok: true, detail: `${detection.entityId} pasa a ${toState}` }
    }

    case "discord": {
      const url = requireString(config, "webhookUrl", action.config)
      if ("missing" in url) return { ok: false, detail: `Falta la variable ${url.missing}` }
      return post(url.value, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: `${detection.ruleId} · ${detection.entityId}`,
              description: decision.message,
              color: SEVERITY_COLOR[detection.severity] ?? 0x95a5a6,
              timestamp: detection.detectedAt,
            },
          ],
        }),
      })
    }

    case "ntfy": {
      const topic = requireString(config, "topic", action.config)
      if ("missing" in topic) return { ok: false, detail: `Falta la variable ${topic.missing}` }
      return post(`https://ntfy.sh/${topic.value}`, {
        method: "POST",
        headers: { Title: detection.ruleId, Priority: detection.severity === "high" ? "high" : "default" },
        body: decision.message,
      })
    }

    case "webhook": {
      const url = requireString(config, "url", action.config)
      if ("missing" in url) return { ok: false, detail: `Falta la variable ${url.missing}` }
      return post(url.value, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detection, decision }),
      })
    }

    case "github_issue": {
      const repo = requireString(config, "repo", action.config)
      if ("missing" in repo) return { ok: false, detail: `Falta la variable ${repo.missing}` }
      const token = requireString(config, "token", action.config)
      if ("missing" in token) return { ok: false, detail: `Falta la variable ${token.missing}` }
      return post(`https://api.github.com/repos/${repo.value}/issues`, {
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
      })
    }
  }
}
```

- [ ] **Step 8: Correr y verificar que pasa**

Run: `npx vitest run adapters/executors/index.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```bash
git add adapters/executors
git commit -m "feat(executors): discord, ntfy, webhook, github issue, state mutation y noop"
```

---

### Task 11: Simulador del restaurante

Cierra el segundo dominio para que el swap de config sea demostrable end-to-end, no solo a nivel de detección.

**Files:**
- Create: `simulators/restaurant.ts`
- Test: `simulators/restaurant.test.ts`

**Interfaces:**
- Produces: `simulateRestaurant(opts: { seed: number; tables: number; from: Date; durationMs: number; forceIncident?: boolean }): NormalizedEvent[]` — misma firma que `simulateVolt` salvo `tables` en lugar de `stations`. Con `forceIncident: true` garantiza una mesa que queda en `Reservada` más de 15 minutos hasta el final.

- [ ] **Step 1: Escribir el test que falla**

`simulators/restaurant.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { simulateRestaurant } from "./restaurant.js"
import { detect } from "../engine/detector.js"
import { DomainConfigSchema } from "../engine/schema.js"
import restaurantRaw from "../configs/restaurant.json" with { type: "json" }

const FROM = new Date("2026-07-25T18:00:00.000Z")
const DURATION = 3 * 60 * 60 * 1000
const opts = { seed: 7, tables: 6, from: FROM, durationMs: DURATION }

describe("simulateRestaurant", () => {
  it("es determinístico para el mismo seed", () => {
    expect(simulateRestaurant(opts)).toEqual(simulateRestaurant(opts))
  })

  it("emite eventos ordenados por timestamp", () => {
    const times = simulateRestaurant(opts).map((e) => Date.parse(e.timestamp))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it("usa solo estados declarados en la config del restaurante", () => {
    const config = DomainConfigSchema.parse(restaurantRaw)
    for (const event of simulateRestaurant(opts)) {
      expect(config.states).toContain(event.state)
    }
  })

  it("con forceIncident garantiza una detección de no-show", () => {
    const config = DomainConfigSchema.parse(restaurantRaw)
    const now = new Date(FROM.getTime() + DURATION)
    const ids = detect(simulateRestaurant({ ...opts, forceIncident: true }), config, now).map(
      (d) => d.ruleId,
    )
    expect(ids).toContain("no-show")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run simulators/restaurant.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`simulators/restaurant.ts`:

```ts
import type { NormalizedEvent } from "../engine/schema.js"
import { createRng } from "./rng.js"

const CYCLE = ["Libre", "Reservada", "Ocupada", "Libre"] as const

export interface SimulateRestaurantOptions {
  seed: number
  tables: number
  from: Date
  durationMs: number
  forceIncident?: boolean
}

export function simulateRestaurant(opts: SimulateRestaurantOptions): NormalizedEvent[] {
  const rng = createRng(opts.seed)
  const events: NormalizedEvent[] = []
  const end = opts.from.getTime() + opts.durationMs

  for (let i = 0; i < opts.tables; i++) {
    const entityId = `mesa-${i + 1}`
    let cursor = opts.from.getTime() + Math.floor(rng() * 15 * 60_000)
    let step = 0

    while (cursor < end) {
      events.push({
        entityId,
        entityType: "table",
        timestamp: new Date(cursor).toISOString(),
        state: CYCLE[step % CYCLE.length]!,
        metadata: { seats: 2 + Math.floor(rng() * 4) },
      })
      cursor += 10 * 60_000 + Math.floor(rng() * 40 * 60_000)
      step++
    }
  }

  if (opts.forceIncident) {
    // Una mesa queda Reservada 25 min antes del cierre y nadie hace check-in.
    const reservedAt = end - 25 * 60_000
    const victim = "mesa-1"
    const kept = events.filter(
      (e) => !(e.entityId === victim && Date.parse(e.timestamp) >= reservedAt),
    )
    kept.push({
      entityId: victim,
      entityType: "table",
      timestamp: new Date(reservedAt).toISOString(),
      state: "Reservada",
      metadata: { seats: 4 },
    })
    events.length = 0
    events.push(...kept)
  }

  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
```

- [ ] **Step 4: Correr toda la suite**

Run: `npm test`
Expected: PASS en todo.

- [ ] **Step 5: Commit**

```bash
git add simulators/restaurant.ts simulators/restaurant.test.ts
git commit -m "feat(sim): simulador de reservas de restaurante"
```

---

## Fase 4 — Superficie pública (Tasks 12-14)

Estas tres tareas son de UI e integración: se verifican en el navegador, no con Vitest. Los tests de `/engine` ya cubren la lógica.

### Task 12: Dashboard de cinco carriles

**Files:**
- Create: `app/layout.tsx`, `app/page.tsx`, `app/pipeline.tsx`, `app/api/decide/route.ts`, `app/api/execute/route.ts`, `next.config.ts`, `.env.example`
- Modify: `package.json` (dependencias y scripts de Next)

**Interfaces:**
- Consumes: `detect`, `suppress`, `createMemoryStore`, `simulateVolt`, `simulateRestaurant`, `execute`, `decide`.
- Produces: `POST /api/decide` → `{ decision: Decision }`; `POST /api/execute` → `{ result: ExecutionResult }`.

- [ ] **Step 1: Instalar Next.js**

```bash
npm install next react react-dom
npm install -D @types/react @types/react-dom
```

Agregar a `scripts` de `package.json`: `"dev": "next dev"`, `"build": "next build"`, `"start": "next start"`.

- [ ] **Step 2: Escribir `.env.example`**

```bash
ANTHROPIC_API_KEY=
DISCORD_OPS_WEBHOOK=
NTFY_TOPIC=centinela-demo
GITHUB_REPO=
GITHUB_TOKEN=
```

- [ ] **Step 3: Escribir las rutas de API**

`app/api/decide/route.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk"
import { decide } from "../../../adapters/decider/claude.js"
import { DomainConfigSchema } from "../../../engine/schema.js"

export async function POST(request: Request) {
  const body = (await request.json()) as { detection: unknown; config: unknown }
  const config = DomainConfigSchema.parse(body.config)
  const client = new Anthropic()

  try {
    const decision = await decide(body.detection as never, config, client)
    return Response.json({ decision })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 })
  }
}
```

`app/api/execute/route.ts`:

```ts
import { execute } from "../../../adapters/executors/index.js"
import { ActionSchema } from "../../../engine/schema.js"

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action: unknown
    decision: unknown
    detection: unknown
  }
  const action = ActionSchema.parse(body.action)
  const result = await execute(
    action,
    body.decision as never,
    body.detection as never,
    process.env,
  )
  return Response.json({ result })
}
```

- [ ] **Step 4: Construir el dashboard**

`app/page.tsx` es un client component que:
1. Lee `?domain=volt|restaurant`, `?seed=42` y `?offline=1` de la URL.
2. Corre el simulador correspondiente con ese seed.
3. Corre `detect` + `suppress` en el navegador (el motor es puro, corre acá).
4. Por cada detección que pasa la supresión, llama a `/api/decide` y después a `/api/execute`.
5. Pinta cinco columnas: **Eventos · Intervalos · Detecciones · Decisión · Acción**, agregando una tarjeta a cada una a medida que avanza.

Botones: selector de dominio, **Forzar incidente** (re-corre el simulador con `forceIncident: true`) y **Reiniciar**.

Con `?offline=1`, `/api/decide` no se llama: se usan decisiones pregrabadas desde un objeto local, para que la demo sobreviva sin wifi.

- [ ] **Step 5: Verificar en el navegador**

Run: `npm run dev`

Verificar a mano:
1. Cargar `/?domain=volt&seed=42` → aparecen eventos y se encienden los cinco carriles.
2. Tocar **Forzar incidente** → aparece una detección de `faulted-stuck` y una decisión de Claude.
3. Cambiar a `?domain=restaurant` → el mismo pipeline responde con vocabulario de restaurante ("mesa", no "estación").
4. Cargar dos veces con el mismo seed → la misma secuencia de eventos.
5. Cargar con `?offline=1` → el pipeline completa sin llamar a la API.

- [ ] **Step 6: Commit**

```bash
git add app next.config.ts .env.example package.json package-lock.json
git commit -m "feat(app): dashboard de cinco carriles con modo determinístico y offline"
```

---

### Task 13: Generador de config

La pieza que convierte la tesis en algo que el votante comprueba con las manos.

**Files:**
- Create: `app/api/generate-config/route.ts`, `app/generate-config.tsx`

**Interfaces:**
- Produces: `POST /api/generate-config` con `{ description: string }` → `{ config: DomainConfig }` o `{ error }` con status 422 si la generación no valida.

- [ ] **Step 1: Escribir la ruta**

`app/api/generate-config/route.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { DomainConfigSchema } from "../../../engine/schema.js"

const SYSTEM = [
  "Generás configuraciones de dominio para Centinela, un motor de monitoreo.",
  "",
  "El motor convierte eventos de cambio de estado en intervalos de duración y",
  "evalúa cuatro tipos de regla sobre ellos:",
  "- duration_in_state: una entidad lleva demasiado tiempo en un estado.",
  "- duration_vs_baseline: dura mucho más que su propio histórico.",
  "- absence_of_events: dejó de reportar.",
  "- frequency_in_window: demasiadas transiciones a un estado en poco tiempo.",
  "",
  "Reglas para generar:",
  "- Los states deben ser un ciclo de vida real y observable de la entidad.",
  "- Cada regla debe referirse a un state que exista en la lista.",
  "- El context lo lee el modelo que redacta las alertas: describí quién las",
  "  recibe y por qué le importa. Dos o tres frases.",
  "- Incluí siempre una acción de tipo noop, para poder no hacer nada.",
  "- Para notificar usá ntfy con config { topic: 'env:NTFY_TOPIC' }.",
  "- Nunca inventes secretos: los valores sensibles van como 'env:NOMBRE'.",
].join("\n")

export async function POST(request: Request) {
  const { description } = (await request.json()) as { description: string }
  const client = new Anthropic()

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: { format: zodOutputFormat(DomainConfigSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: description }],
  })

  if (!response.parsed_output) {
    return Response.json(
      { error: "No se pudo generar una configuración válida. Probá describiendo el dominio con más detalle." },
      { status: 422 },
    )
  }

  return Response.json({ config: response.parsed_output })
}
```

- [ ] **Step 2: Construir la UI**

`app/generate-config.tsx`: un input de texto ("¿Qué querés monitorear?"), un botón, y al recibir la config la carga en el pipeline con un simulador genérico que hace ciclar las entidades por los `states` del config.

- [ ] **Step 3: Verificar en el navegador**

Run: `npm run dev`

Probar con al menos tres descripciones distintas, por ejemplo:
- "monitoreo las camas de mi clínica veterinaria"
- "quiero vigilar los servidores de mi empresa"
- "superviso los buses de una ruta escolar"

Verificar en cada caso: la config valida, aparece en pantalla, y el pipeline arranca con ella.

- [ ] **Step 4: Commit**

```bash
git add app/api/generate-config app/generate-config.tsx
git commit -m "feat(app): generador de config con structured outputs"
```

---

### Task 14: Deploy y pieza de votación

**Files:**
- Create: `README.md`

- [ ] **Step 1: Crear el repo en GitHub y pushear**

```bash
git remote add origin <URL-del-repo>
git push -u origin main
```

- [ ] **Step 2: Desplegar en Vercel**

Importar el repo en Vercel y cargar las variables de entorno de `.env.example` con sus valores reales. `NTFY_TOPIC` debe ser un topic único e impredecible.

- [ ] **Step 3: Verificar el deploy**

Abrir la URL pública y repetir la verificación manual del Task 12, más el generador de config. Probar desde un celular que la notificación de ntfy llega.

- [ ] **Step 4: Escribir el README**

Debe abrir con la tesis en una frase, un GIF del pipeline encendiéndose, el enlace a la demo, cómo correrlo local, y la tabla de las 4 reglas contra los 2 dominios.

- [ ] **Step 5: Grabar el video**

Con `?seed=<fijo>` y el botón de forzar incidente, en este orden: VOLT falla → llega la alerta a Discord → cambiar a restaurante con el mismo motor → generar un dominio nuevo en vivo desde una frase.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: README con la tesis y el enlace a la demo"
git push
```

---

## Notas de ejecución

**Orden de corte si el tiempo aprieta** — en este orden, y solo en este orden:

1. **Task 7 Steps 1-4** (`duration_vs_baseline`) — las otras tres reglas ya cubren ambos dominios. Sacarla implica quitar `long-session` de `volt.json` y `sobremesa` de `restaurant.json`.
2. **El executor `github_issue`** dentro del Task 10 — es el único que necesita un PAT.
3. El **Task 13** (generador de config) se defiende hasta el final: es lo que convierte la tesis en algo comprobable.

**El motor se termina antes de tocar la UI.** Tasks 1-7 son la base de todo lo demás; si esa parte queda a medias, no hay demo que la salve.
