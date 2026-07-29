# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primario: Plogui y clientes potenciales.** Evaluadores del concurso y las
empresas a las que Plogui podría vender esto después. Llegan escépticos, con
más tiempo que un votante casual, y con una pregunta concreta: *¿esto se
reconfigura a mi dominio sin reescribir el sistema, o es una automatización de
un solo uso disfrazada?* Su trabajo al visitar la página es decidir si el motor
es reusable, no si la demo es linda.

**Secundario: el público votante del concurso.** La fase final de Plogui se
decide por votación abierta, así que cualquier persona puede llegar por el
link, mirar dos minutos y votar. No tiene contexto técnico. La página no puede
depender de que entienda la arquitectura, pero tampoco se optimiza para él por
encima del primario.

La distinción importa porque los dos quieren cosas distintas de la misma
pantalla: el votante quiere entender de un vistazo qué hace; Plogui quiere
evidencia de que el dominio es configuración y no código.

## Product Purpose

**Reflex Agent** es un motor genérico de agentes de monitoreo y acción
automática. La secuencia es siempre la misma —vigilar → detectar patrón →
decidir acción → ejecutar— sin importar si se vigilan estaciones de carga
eléctrica, mesas de un restaurante o cualquier entidad con estados que cambian
en el tiempo. Lo único que cambia entre un cliente y otro es qué cuenta como
evento, qué patrón importa y qué acciones hay disponibles.

Esta página es el **playground público**: corre el motor de verdad, en vivo, a
la vista, y deja cambiar de dominio con un parámetro de URL.

Éxito es que un evaluador cambie de dominio en la página y vea el mismo motor
produciendo un juicio distinto —"mesa 7" donde decía "estación EVC-03"— sin que
nada del sistema haya cambiado salvo un archivo de configuración.

## Positioning

Lo que un producto vecino no puede copiar honestamente: **el agente muestra lo
que descartó, y por qué.**

La página no exhibe una decisión, exhibe una deliberación. Cada caso muestra las
tres acciones del dominio: la elegida encendida con su motivo y el mensaje que
lee una persona, y las descartadas en gris con el razonamiento de por qué no.
Más el contrafáctico —qué tendría que haber sido distinto para que la decisión
cambiara.

Sin las alternativas, un agente es indistinguible de un `switch (ruleId)`. Con
ellas, se vuelve verificable que hubo criterio. La exhaustividad no se pide en
el prompt: la impone el `input_schema` de cada tool, que bajo `strict: true`
hace estructuralmente imposible que el modelo omita una alternativa.

El segundo diferenciador es la **contención**: la deliberación viaja en un tipo
separado de la decisión, así que el texto del modelo no tiene ninguna ruta hasta
un issue de GitHub ni un canal de Discord. No por un filtro que alguien deba
mantener, sino porque la ruta no existe.

## Operating Context

El visitante llega por un link —del concurso, o de un video— y no instala nada.
La página corre el pipeline completo en el navegador contra rutas de API
propias.

Parámetros de URL que forman parte de cómo se evalúa el producto:

- `?domain=volt|restaurant` — cambiar de dominio, que es la tesis entera
- `?offline=1` — corre el pipeline con decisiones pregrabadas, sin clave ni gasto
- `&seed=42` · `&force=1` · `&max=3` · `&view=full` · `&at=ISO`

**Dos despliegues distintos, a propósito:**

- **público** — sin **ninguna** de las cuatro variables de destino:
  `GITHUB_TOKEN`, `GITHUB_REPO`, `DISCORD_OPS_WEBHOOK` **ni `NTFY_TOPIC`**. Las
  rutas `/api/decide` y `/api/execute` son públicas y sin autenticación; la
  ausencia de esas variables **es** la mitigación, porque el executor corta
  antes de cualquier llamada de red y la tarjeta dice qué variable falta.
  La lista son **los cuatro executors que salen a la red** —discord, ntfy,
  webhook, github_issue—; `noop` y `state_mutation` nunca la tocan. Si aparece
  un executor de red nuevo, **esta lista es parte de su definición de listo**:
  quedó desactualizada una vez (faltaba `NTFY_TOPIC`, que además venía con
  valor en `.env.example`) y una mitigación que enumera sólo protege si la
  enumeración está al día.
- **grabación** — con todos los secretos, para el video.

VOLT (Energy Mobility) es una plataforma real de carga de vehículos eléctricos
con arquitectura orientada a eventos, y es el primer caso de uso real del motor
—no el límite de lo que hace. El primitivo de convertir eventos crudos de cambio
de estado en intervalos de duración viene validado de ahí.

## Capabilities and Constraints

**Lo que hace hoy:**

- Normaliza eventos de cualquier origen a un esquema común (entidad, timestamp,
  estado, metadata).
- Detecta patrones por reglas de configuración: duración en estado, frecuencia
  en ventana, ausencia de heartbeat.
- Decide con Claude vía tool use, con una tool generada por acción del dominio.
- Ejecuta por plugins intercambiables: Discord, GitHub Issues, noop.
- Suprime alertas repetidas por `cooldownKey` (`ruleId:entityId`).

**Stack real, que manda sobre cualquier documento previo:** Next.js (App
Router), TypeScript, el SDK de Anthropic, y executors de Discord + GitHub
Issues. `centinela-propuesta.md` describe n8n, Supabase y WhatsApp/Telegram:
ese era el plan **antes** de construir y quedó viejo. Es evidencia histórica,
no verdad del producto.

**Restricciones técnicas duraderas:**

- **Cero dependencias nuevas.** El escalonado, el vidrio y el dock son CSS a
  mano. `framer-motion` se rechazó tres veces.
- **Determinismo.** El `seed` fija los eventos y `at` fija el instante de
  evaluación: dos corridas con los mismos parámetros dan exactamente lo mismo,
  hasta el timestamp. Sin eso el playground no sería verificable.
- **La deliberación no llega al executor.** Los executors reciben `Decision` y
  nada más. Ensanchar lo que llega a `/api/execute` rompe la garantía.
- La evidencia se cerca y se escapa antes de entrar al prompt (`<` → `&lt;`),
  porque `/api/decide` es una ruta pública y su evidencia es un record abierto.

**Terminología del producto** (en español, deliberada): *expediente* (el caso
completo), *boleta* (las tres acciones con la elegida y las descartadas),
*carriles* (las etapas del pipeline), *embudo* (el angostamiento de eventos a lo
que llegó a una persona), *contrafáctico* (qué cambiaría la decisión),
*mascota* (el indicador de progreso).

**Sin decidir:** si el motor se ofrece como producto instalable, como servicio,
o sólo como demostración de capacidad para conseguir clientes de Plogui.

## Brand Commitments

- **El nombre es Reflex Agent.** Se cambió desde "Centinela" por decisión
  explícita: *"Centinela sin más es muy olvidable"*. El nombre viejo sobrevive
  en rutas internas y nombres de archivo; eso no lo reabre.
- **La interfaz es en español.** Incluidos los identificadores de dominio del
  código de UI.
- **Un solo modo: claro.** El modo oscuro se eliminó por pedido explícito
  —*"al final quedémonos con el modo claro, es lo que mejor le queda al
  proyecto"*—. No hay tokens `--d-*`, ni rama de `prefers-color-scheme`, ni
  interruptor.
- Las referencias visuales pinneadas viven en `references/` y `DESIGN.md` es la
  autoridad visual. Un brief pinneado gana a cualquier default.

## Evidence on Hand

- **El motor corre de verdad.** El camino en vivo a Claude está verificado
  contra el build de producción, no sólo contra dev.
- **Dos dominios completos y reales como configuración**: `configs/volt.json`
  (estaciones de carga, estados tipo OCPP 2.0.1) y `configs/restaurant.json`
  (mesas). Los dos ejercitados por la vía real contra la API.
- 196 tests automatizados, 18 archivos.
- Decisiones pregrabadas para el modo offline, para demostrar sin gastar ni
  necesitar clave.
- Sondas reales contra `/api/decide` documentadas en el ledger de la fase del
  expediente.

**Ausencias que el trabajo futuro NO debe fabricar:** no hay clientes reales
usando esto, no hay testimonios, no hay benchmarks, no hay métricas de
producción, y no hay caso de estudio. VOLT es un proyecto del mismo autor, no
un cliente. El video de demostración todavía no existe.

## Product Principles

1. **Lo que el agente descartó es el producto.** Si hay que elegir entre
   mostrar más resultados o mostrar el razonamiento detrás de uno, gana el
   razonamiento. Sin alternativas visibles no hay evidencia de criterio.
2. **El dominio es configuración, nunca código.** Cualquier funcionalidad que
   sólo sirva para VOLT y no se exprese como config contradice la tesis
   completa del proyecto.
3. **La contención es estructural, no un filtro.** Las garantías se sostienen
   porque el camino no existe, no porque alguien se acuerde de mantener una
   lista.
4. **Determinismo antes que variedad.** Una demo que no se puede reproducir no
   se puede verificar, y a un evaluador escéptico hay que dejarlo verificar.
5. **El silencio es un resultado.** Que el motor decida no actuar —y lo diga
   con su motivo— vale tanto como que actúe. Un bot de notificaciones no puede
   hacer eso.

## Accessibility & Inclusion

Piso serio, sin perseguir certificación formal ni auditar contra un estándar.

Lo que el trabajo futuro respeta siempre: contraste real en texto (el amarillo
puro no pasa sobre claro —1.46:1— así que cuando hace falta amarillo legible se
usa el oro profundo), foco visible, estructura anunciable para lectores de
pantalla, y `prefers-reduced-motion` honrado de verdad —incluidos los
`animation-delay`, no sólo las duraciones.

Deuda conocida y anotada: al colapsar las etapas 4 y 5 en una sola parada, dos
pestañas quedan con `aria-current="step"` a la vez, rompiendo el supuesto de
"exactamente un paso actual".
