# Centinela — Motor genérico de agentes de monitoreo y acción automática

## 1. Contexto

Proyecto presentado al carril **Automatizaciones y Agentes IA** del concurso de Plogui. Pasó a la fase final, que se decide por **votación pública** (cualquier persona puede votar).

Detalle clave del concurso: los proyectos presentados —ganen o no— son impulsados para que sus desarrolladores empiecen a construir soluciones para **clientes reales de Plogui**. Esto cambia el objetivo del proyecto: no basta con un demo llamativo para ganar votos, tiene que quedar demostrado que es **reconfigurable a distintos clientes/dominios sin reescribir el sistema**, porque eso es literalmente lo que Plogui va a pedir después.

Autor: estudiante en Colombia, actualmente construyendo **VOLT (Energy Mobility)**, una plataforma de carga de vehículos eléctricos con arquitectura orientada a eventos (Kafka, Supabase, decomposición en 12 dominios). Ese proyecto se usa como primer caso de uso real del motor, no como el límite de lo que hace.

## 2. Propuesta

La idea central es separar el **motor** del **dominio**:

```
vigilar → detectar patrón → decidir acción → ejecutar
```

Esta secuencia es siempre la misma sin importar si se vigilan estaciones de carga, mesas de un restaurante o citas médicas. Lo único que cambia entre un cliente y otro es:
- qué cuenta como **evento**
- qué **patrón** importa
- qué **acciones** hay disponibles

Si eso se construye como **configuración** en vez de código específico, el resultado es un producto que Plogui puede vender a cualquier cliente, no una automatización de un solo uso.

Un primitivo ya validado en VOLT se reutiliza directamente: transformar eventos crudos de cambio de estado en intervalos de duración (usado ahí para ocupación de estaciones) es exactamente lo que necesita el normalizador de eventos — es un truco de "cualquier entidad con estados que cambian en el tiempo", no algo específico de carga eléctrica.

## 3. Arquitectura del motor (Centinela general)

### 3.1 Normalizador de eventos
Convierte cualquier entrada (webhook, API, mensaje) a un esquema común:
```json
{
  "entidad_id": "string",
  "timestamp": "ISO8601",
  "estado": "string",
  "metadata": {}
}
```

### 3.2 Detector de patrones
Reglas simples (umbral, duración, ausencia de heartbeat) evaluadas sobre el stream normalizado. Cuando la regla no es binaria (ambigüedad de interpretación), se apoya en Claude para decidir si el patrón amerita acción.

### 3.3 Decisor
Claude con **tool use**: recibe el patrón detectado + el set de acciones disponibles *para ese dominio* (vienen de la config, no hardcodeadas) y decide cuál ejecutar.

### 3.4 Ejecutor de acciones
Plugins intercambiables: enviar WhatsApp/Telegram, crear ticket, actualizar Supabase, llamar un webhook externo.

### 3.5 Capa de configuración por dominio
El archivo que hace que cambiar de cliente sea configuración y no reescritura:
```json
{
  "dominio": "string",
  "eventos": [
    { "tipo": "string", "payload_esperado": {} }
  ],
  "patrones": [
    { "nombre": "string", "condicion": "string", "descripcion": "string" }
  ],
  "acciones": [
    { "nombre": "string", "tipo": "whatsapp | webhook | db_update", "config": {} }
  ]
}
```

## 4. Stack técnico

| Capa | Herramienta | Motivo |
|---|---|---|
| Orquestación | **n8n** | Visual — se puede mostrar el flujo "encendiéndose" en vivo durante la demo |
| Decisor | **API de Claude** (tool use) | Acciones definidas por config, no hardcodeadas |
| Almacenamiento | **Supabase** | Ya está el modelo de datos pensado desde VOLT |
| Canal de salida | **WhatsApp / Telegram** | Lo más demostrable en video para el público votante |

## 5. Implementación 1 — VOLT (dominio real, producción)

Primer caso de uso real, no un mockup. Usa datos reales o simulados de las estaciones de carga de VOLT.

- **Eventos**: cambios de estado por estación (basado en estatus tipo OCPP 2.0.1: `Available`, `Occupied`, `Charging`, `Faulted`, `Reserved`, `Unavailable`).
- **Patrones a vigilar**:
  - Estación atascada en `Faulted` más de X minutos.
  - Sesión de carga corriendo más tiempo del esperado (posible auto olvidado o falla).
  - Estación sin heartbeat (offline inesperado).
  - Pico de demanda concentrado en una zona/estación.
- **Acciones**:
  - Alerta al equipo de operaciones vía WhatsApp.
  - Creación de ticket de mantenimiento.
  - Notificación de rebalanceo de demanda.

Nota: esta implementación queda pensada para conectarse más adelante a la arquitectura completa de eventos (Kafka) de Energy Mobility. Para el alcance del concurso, el flujo vía n8n + Supabase es suficiente y más rápido de demostrar.

## 6. Implementación 2 — Dominio secundario (prueba de generalidad)

Objetivo: demostrar en vivo que apuntar el motor a otro cliente es cuestión de cargar otra config, no reescribir el agente. No necesita estar pulida, solo funcionar con datos de juguete.

**Dominio sugerido: reservas de mesas en un restaurante**
- **Eventos**: mesa `Libre` / `Reservada` / `Ocupada`.
- **Patrones**: mesa reservada sin check-in a los X minutos (riesgo de no-show), mesa ocupada más tiempo del promedio.
- **Acciones**: WhatsApp al dueño, liberar la reserva automáticamente.

## 7. Demo y pitch para el jurado / votación pública

**Narrativa central:**
> "Construí un motor de agentes de monitoreo, y esta es su primera implementación en producción real — mi propia plataforma de movilidad eléctrica. Aquí muestro que apuntarlo a otro cliente es cuestión de configuración, no de reconstruir todo."

**Piezas necesarias para el demo:**
- Video de 30-60s mostrando el flujo VOLT funcionando de principio a fin (evento real → alerta real por WhatsApp).
- Momento en vivo (o en el mismo video) cargando la config del dominio secundario y mostrando que el mismo motor responde distinto.
- Flujo de n8n visible en pantalla — es el momento más fuerte para un público no técnico.
- Número de impacto cuantificado (tiempo de detección/respuesta antes vs. después).

## 8. Roadmap sugerido de construcción

1. Normalizador de eventos + esquema de config (JSON Schema/Zod).
2. Detector de patrones con reglas simples (umbral/duración).
3. Decisor con Claude API (tool use), acciones inyectadas desde config.
4. Ejecutor de acciones: WhatsApp/Telegram + Supabase.
5. Config y datos de VOLT — flujo end-to-end funcionando.
6. Config del dominio secundario (restaurante) — prueba de reconfiguración.
7. Pulido de demo: video, mensajes reales, landing/página de voto.

## 9. Nota para arrancar con Claude Code

Sugerencia de orden de trabajo en la sesión de Claude Code: empezar por el punto 3 (normalizador + schema de config), porque todo lo demás depende de ese contrato de datos. Una vez esté el normalizador y la config de VOLT cargando correctamente, seguir con el detector de patrones antes que el decisor, para poder probar el pipeline con reglas simples sin depender todavía de llamadas a la API de Claude.
