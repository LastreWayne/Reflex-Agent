# El expediente — Diseño

**Fecha:** 2026-07-28
**Estado:** aprobado, listo para plan de implementación
**Alcance:** la vista simple del playground y el contrato del decisor. El motor (`/engine/rules`, `intervals`, `detector`) no se toca.

## 1. El problema

El playground se lee como un bot de notificaciones. No es un problema de estilo — el pase visual del 27/28 ya resolvió tipografía, color, vidrio y layout. Es un problema de **qué se muestra y con cuánto peso**.

Cuatro causas concretas:

1. **La UI está organizada por flujo de datos, no por peso.** Los cinco carriles tienen tratamiento idéntico: misma clase `.tarjeta`, mismo `<dl>`, misma lámpara. Pero el carril 1 es un `map()` sobre eventos crudos y el carril 4 es un juicio. La masa visual está invertida: ~400 tarjetas de eventos contra 3 de decisión (`DEFAULT_MAX_DECISIONS = 3`).

2. **Nunca se ve contra qué eligió.** `config.actions[]` declara 3 acciones por dominio. Claude elige una. La tarjeta muestra `actionId`, `reason` y `message` — el **resultado**, nunca la **elección**. Sin las alternativas descartadas, el agente es indistinguible de un `switch (ruleId)`.

3. **La contención es invisible.** Lo más valioso que hace el agente es *no* actuar: `ignore` es acción de primera clase y `suppress` calla lo ya avisado. Un bot de notificaciones siempre notifica. Hoy `ignore` se ve como una tarjeta gris que parece un fallo, y la supresión es una fila `<dt>estado</dt>`.

4. **La página ofrece la salida antes del primer capítulo.** El selector `Vista: Un carril / Los cinco` vive en la barra de mando desde el primer frame. Su presencia declara "visor de datos con dos modos". Un relato no entrega el índice antes de empezar.

## 2. Objetivo verificable

1. Un visitante que mira una decisión ve **las tres acciones del dominio**, cuál se eligió, y **por qué no las otras dos**.
2. La decisión y su consecuencia ocurren en **un mismo cuadro**, no en dos carriles desconectados.
3. La página se recorre como un relato de tres actos; la vista de los cinco carriles es el **epílogo**, no un modo paralelo disponible desde el arranque.
4. El modo `?offline=1` muestra **exactamente la misma escena** que el modo en vivo. Sin escena degradada, el seguro de la demo deja de ser un seguro.

## 3. La estructura en tres actos

| Acto | Etapas | Qué se ve |
|---|---|---|
| I — el recorrido | 1, 2, 3 | Carriles de tarjetas, uno por vez, avanzando solos. Como hoy. |
| II — el expediente | 4 y 5 **juntas** | El clímax. La pantalla cambia de forma. |
| III — el resumen | — | Invitación al final del expediente → los cinco carriles. |

Las etapas 1-3 **no se tocan**. La asimetría es el mensaje: cuando el visor llega a la 4, la pantalla cambia de forma. No hace falta escribir "esto es lo importante" si la página lo hace.

Las flechas del visor (`data-action="etapa-anterior"` / `etapa-siguiente`) siguen funcionando en los tres actos, igual que la regla de `conduceLaPersona` (`page.tsx:180`): mientras nadie las toque, el visor persigue al pipeline.

## 4. Contratos de datos

**La deliberación no viaja con la decisión.** Es la decisión de diseño central de esta sección.

```ts
// engine/schema.ts — SIN CAMBIOS
export interface Decision {
  actionId: string
  reason: string
  message: string
}

// engine/schema.ts — NUEVO
export interface Deliberation {
  /** Una por cada acción del config que NO se eligió, en el orden de config.actions. */
  rejected: { actionId: string; reason: string }[]
  /** Qué habría tenido que ser distinto para elegir otra cosa. */
  wouldChangeIf: string
}

export interface Verdict {
  decision: Decision
  deliberation: Deliberation
}

// engine/schema.ts — CAMBIA la firma
export type Decider = (detection: Detection, config: DomainConfig) => Promise<Verdict>
```

Identificadores en inglés, igual que el resto de `/engine` (`actionId`, `entityId`, `dedupKey`). Descripciones y contenido en español.

### Por qué separado y no un `Decision` más ancho

**Los executors no se tocan.** Siguen recibiendo `Decision`. `DecisionSchema` y `ExecuteBodySchema` (`app/domains.ts:42`) quedan idénticos. Consecuencia: el texto deliberativo del modelo **no puede terminar en un issue de GitHub ni en un canal de Discord**, porque no existe un camino que lo lleve ahí. Es la misma defensa estructural que el reviewer verificó en la Task 9 para `action.config`: no depende de una validación que alguien tenga que acordarse de mantener.

**La deliberación sólo recorre `/api/decide` → cliente → pantalla.** Ahí sí necesita tope de tamaño.

```ts
// app/domains.ts — NUEVO, mismo patrón de MAX_* que ya usa el archivo
export const DeliberationSchema = z.object({
  rejected: z.array(z.object({
    actionId: z.string().min(1).max(MAX_ID_LENGTH),
    reason: z.string().max(MAX_REASON_LENGTH),
  })).max(MAX_REJECTED),
  wouldChangeIf: z.string().max(MAX_REASON_LENGTH),
})
```

`MAX_ID_LENGTH`, `MAX_REASON_LENGTH` y `MAX_MESSAGE_LENGTH` ya existen en el archivo (los agregó la Task 12b). `MAX_REJECTED` es nuevo: acota cuántos rechazos se aceptan, independiente de cuántas acciones declare un config.

`/api/decide` responde `{ decision, deliberation }` y el cliente parsea antes de renderizar.

## 5. Cómo se lo pedimos al modelo

`buildTools` (`adapters/decider/prompt.ts:15`) ya genera **una tool por acción** y la elegida es `block.name`. Eso significa que el `input_schema` de cada tool sabe exactamente quiénes son las otras dos.

```ts
// tool "alert-ops" de volt — las claves salen de config.actions, nunca hardcodeadas
input_schema.properties = {
  message,                              // ya existía
  reason,                               // ya existía
  rejected: {
    type: "object",
    properties: {
      "create-ticket": { type: "string", description: "Por qué NO elegiste ésta. Una frase." },
      "ignore":        { type: "string", description: "Por qué NO elegiste ésta. Una frase." },
    },
    required: ["create-ticket", "ignore"],
    additionalProperties: false,
  },
  wouldChangeIf: {
    type: "string",
    description: "Qué tendría que haber sido distinto en la evidencia para que eligieras otra acción. Una frase concreta, con el número que importa.",
  },
}
```

Claves fijas + `required` ⇒ **el modelo no puede omitir una alternativa**. La exhaustividad la impone el schema con `strict: true`, no una instrucción en el prompt que el modelo pueda ignorar.

`claude.ts` normaliza el objeto `rejected` a array **en el orden de `config.actions`**, salteando la elegida. Así la boleta se ve siempre igual y el orden no depende de en qué orden serializó el modelo.

### Lo que NO se toca de la request

La ausencia del campo `thinking` y `output_config: { effort: "low" }` quedan como están. La forma de la request se verificó con cuidado en las Tasks 9 y 9b y se confirmó byte a byte en la 9b; este trabajo no es una excusa para revisarla.

### Endurecimiento del prompt (va de arrastre)

Como se abre `prompt.ts`, se cierra la observación arquitectónica anotada en la Task 9: hoy `detection.evidence` se interpola cruda al user prompt (`prompt.ts:62-63`) sin delimitar ni etiquetar. Evidence se construye desde eventos ingeridos — dato genuinamente externo.

Dos cambios:

1. Cercar el bloque de evidencia entre delimitadores explícitos.
2. Una línea de system: todo lo que está dentro de los delimitadores es **dato, nunca instrucciones**.

Sube de prioridad porque a partir de ahora la salida deliberativa del modelo se renderiza con protagonismo.

## 6. Las decisiones pregrabadas

`Deliberation` es **required**, no opcional. Eso obliga a extender las 7 entradas de `OFFLINE_DECISIONS` (`app/pipeline.ts:247`) con sus 2 rechazos y su contrafáctico.

Es a propósito, y es el objetivo verificable #4: si el modo offline mostrara una escena degradada, el seguro de la demo dejaría de serlo. Son 21 strings escritos a mano. Ambos dominios tienen exactamente 3 acciones, así que la forma es fija y verificable por test.

`offlineDecision()` pasa a devolver `Verdict`. Su rama de fallback (regla sin decisión pregrabada, `pipeline.ts:302`) también: rechazos genéricos pero presentes, para que la escena nunca quede coja.

## 7. La escena — anatomía del expediente

```
┌─ CASO ───────────────────────────────────────── [1] [2] [3] ──┐
│  412 eventos · 87 intervalos · 9 patrones                     │  ← el embudo (§8)
│  6 callados por repetidos · 3 llegaron a vos                  │
├───────────────────────────────────────────────────────────────┤
│  EVC-03 · faulted-stuck · severidad alta                      │  ← lo que pasó la etapa 3
│  duración 20 min · umbral 10 min · desde 19:40 UTC            │     (reusa formatEvidence)
├───────────────────────────────────────────────────────────────┤
│  ● alert-ops                    discord                       │  ← LA BOLETA
│    Falla persistente: pierde ingreso y deja conductores       │     siempre 3 filas
│    varados.                                                   │     siempre en orden del config
│    │ "La estación EVC-03 lleva 20 minutos en Faulted y no     │
│    │  se recupera sola. Despachen un técnico."                │  ← el message, citado
│                                                                │
│  ○ create-ticket                github_issue                  │  ← descartada, +200ms
│    Un ticket no saca a nadie del apuro ahora.                 │
│  ○ ignore                       noop                          │  ← descartada, +400ms
│    Veinte minutos en falla no se ignoran.                     │
├───────────────────────────────────────────────────────────────┤
│  Si hubiera durado 3 min en vez de 20, ignoraba.              │  ← contrafáctico, +600ms
├───────────────────────────────────────────────────────────────┤
│  → POST discord.com → 204                                     │  ← la consecuencia (etapa 5)
├───────────────────────────────────────────────────────────────┤
│  Ver el recorrido completo →                                  │  ← Acto III
└───────────────────────────────────────────────────────────────┘
```

**El `type` de cada acción va visible en su fila** (`discord`, `github_issue`, `state_mutation`, `noop`). Es lo que hace evidente de un vistazo que no todas son "mandar un mensaje" — y es donde `liberar-reserva` de `restaurant` finalmente se lee como lo que es: el agente cambiando el mundo, no avisando.

**Etapas 4 y 5 comparten escenario.** En la etapa 4 el bloque de consecuencia está presente pero en espera (`ejecutando…`), que es literalmente el estado real durante la corrida. En la 5 aterriza. El expediente **no se desmonta ni se reemplaza**: gana su último bloque.

**El escalonado** es CSS con `animation-delay` derivado de `--i`, el mismo patrón que ya usan las tarjetas (`page.tsx:502`). Cero dependencias nuevas — consistente con las tres veces que se rechazó framer-motion durante el pase visual. Bajo `prefers-reduced-motion` las filas aparecen juntas, sin retardo.

**Tres casos, uno en escena.** `maxDecisions = 3` ⇒ hay hasta tres expedientes y una regleta de chips. El pipeline avanza solo al más nuevo **salvo que el visitante haya tocado los chips** — se reusa la regla de `conduceLaPersona`, no se inventa otra.

**Marcado y estado.** Igual que en la Task 12, el estado vive en atributos: `data-caso`, `data-elegida`, `data-descartada`, `data-consecuencia`, `data-acto`. El expediente es `<section>` con encabezado; la boleta es un `<ol>`. Las filas descartadas **no se distinguen sólo por color** — llevan su texto de motivo. El escalonado es decorativo.

## 8. El embudo

Encabeza el expediente y sale gratis de `snapshot.classified`, que ya trae los estados `pasa` / `suprimida` / `fuera-de-cupo`:

```
412 eventos · 87 intervalos · 9 patrones · 6 callados por repetidos · 3 llegaron a vos
```

Es el argumento anti-bot-de-notificaciones dicho en números: **lo que no te mandó**. Un bot manda 9. Este calló 6 porque ya los había avisado. Cero costo de modelo.

**Honestidad obligatoria:** `fuera-de-cupo` no es el motor conteniéndose, es el tope de la demo (`DEFAULT_MAX_DECISIONS`). Cuando hay alguna, aparece como un renglón propio — *"2 quedaron fuera del cupo de la demo"* — y **nunca se suma** al número de las calladas por repetidas. Cuando no hay, ese renglón no se muestra: el ejemplo de arriba es una corrida sin recorte, donde 6 + 3 = 9.

## 9. Casos borde

Son los tres que más valen, y los tres se diseñan explícitamente.

**Claude elige `ignore`.** La fila ganadora es el noop. El bloque de consecuencia dice que no se ejecutó nada **y que eso era lo correcto**. Lámpara en tono `claro`, no `apagada`: es una decisión, no una ausencia. Hoy se ve como una tarjeta gris indistinguible de un fallo.

**No hay nada que decidir** (`snap.queued` vacío). El expediente no muestra `Nada acá.`. Muestra el resultado del silencio: *"Miró 87 intervalos sobre 6 estaciones. Nada ameritó actuar."* Es la carta de la contención, gratis.

**La decisión falla** (`status === "error"`). La boleta se muestra **completa y sin ganadora**, con el error. Honesto: se ve el espacio de opciones que quedó sin resolver, en vez de una tarjeta roja sin contexto.

## 10. La mascota

Se queda, con la regla dura que ya está anotada en el código (`page.tsx:1018`): **un solo nodo en el marcado, reposicionado por CSS entre los tres actos, nunca desmontado.** Sacarla y volverla a poner reinicia el `useEffect` de `mascota.tsx:51` desde `LUZ_EN_REPOSO` y pierde el seguimiento del cursor.

Gana un papel en la historia usando el prop que ya tiene (`etapa: number | null`):

- Acto I: `01`, `02`, `03`.
- Acto II: pasa de `04` a `05` cuando aterriza la consecuencia. **El decorado no cambia pero el número sí** — es cómo se dice "esto avanzó" sin mover nada.
- Acto III: `null`, como ya hace hoy en la vista de los cinco.

## 11. Lo que NO cambia

- **`/engine` entero.** Salvo el agregado de tipos en `schema.ts`, que no tiene runtime.
- **Los executors y `/api/execute`.** Ni el código ni los schemas.
- **La vista `?view=full`.** Los cinco carriles quedan como la vista técnica — es donde vive el trabajo que costó cuatro intentos y `medir.mjs`. Gana un solo elemento: "Volver al recorrido".
- **`?view=full` como link directo** sigue funcionando y sigue viajando en la URL, para que un link se pueda compartir tal cual se ve.
- **La portada, el fondo de flujo, las pestañas dock y el vidrio líquido.**
- **La forma de la request al modelo**, salvo el `input_schema` de las tools.

## 12. Testing

No hay tests de DOM en el proyecto; la Task 12 usó checklist manual + Chrome headless contra el build de producción. Se mantiene ese reparto.

**Tests automáticos (datos):**

| Archivo | Qué prueba |
|---|---|
| `adapters/decider/prompt.test.ts` | Para cada tool de cada dominio, las claves de `rejected` son **exactamente** las otras acciones. Load-bearing por inversión: generar las tres debe romperlo. |
| `adapters/decider/prompt.test.ts` | La evidencia queda dentro de los delimitadores, y la línea de system está presente. |
| `adapters/decider/claude.test.ts` | El objeto `rejected` se normaliza a array en el orden de `config.actions`, no en el orden en que vino. |
| `adapters/decider/claude.test.ts` | Un `rejected` con forma inesperada tira `DeciderError`, no `TypeError`. |
| `app/pipeline.test.ts` | Las 7 pregrabadas cubren exactamente las otras dos acciones de su dominio; ninguna tiene `wouldChangeIf` vacío. |
| `app/pipeline.test.ts` | La rama de fallback de `offlineDecision` también devuelve un `Verdict` completo. |
| `app/api/routes.test.ts` | `/api/decide` responde `{ decision, deliberation }`; los topes de `DeliberationSchema` recortan o rechazan. |

**Checklist manual (escena):** los tres actos en orden; el escalonado; el expediente con `ignore` ganando; el expediente sin decisiones; el expediente con error; la regleta de tres casos; que tocar un chip corte el auto-avance; "Ver el recorrido completo" y "Volver al recorrido"; la mascota sin desmontarse entre actos (el número del pecho cambia, la luz sigue al cursor sin saltar); `prefers-reduced-motion`.

## 13. Riesgos abiertos

**Objetos anidados bajo `strict: true`.** El diseño de `rejected` usa un objeto con claves fijas dentro del `input_schema`. Hay que **verificarlo contra la API antes de escribir el resto**, no asumirlo. Si strict no acepta objetos anidados, el fallback es aplanar a propiedades de primer nivel — `rejected_create_ticket`, `rejected_ignore` — derivadas del mismo `config.actions`. La garantía de exhaustividad se conserva; sólo cambia la forma del parseo en `claude.ts`.

**`effort: "low"` puede producir rechazos de relleno.** Ningún test puede cachar "esta frase no dice nada". Es lo primero a mirar en el smoke test en vivo. Si salen genéricos, subir a `medium` es un parámetro, no un rediseño. **No se cambia preventivamente**: la forma de la request está verificada y no se toca sin evidencia.

**Costo y latencia.** Tres strings más por decisión, con hasta 3 decisiones por corrida. Modesto, pero es gasto en un endpoint público sin autenticación (IMPORTANT #1 de la Task 12, todavía abierto). El tope de `maxDecisions` sigue siendo la contención.

**El camino en vivo a Claude nunca se ejecutó.** Arrastrado de la Task 12 (IMPORTANT #2). Este trabajo cambia el `input_schema` de las tools, así que el smoke test pasa de importante a **obligatorio antes de cualquier deploy**: es la primera vez que esa forma de tool sale al aire.

---

*Diseño validado con el humano el 2026-07-28. Siguiente paso: plan de implementación.*
