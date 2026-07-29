import type { CSSProperties, ReactNode } from "react"
import type { BallotRow, Funnel } from "./pipeline.js"

/*
 * El expediente: el clímax de la página y lo único que no se parece a un log.
 *
 * Es TONTO a propósito. No corre el motor, no hace fetch y no decide nada: la
 * lógica vive en `buildFunnel` y `buildBallot` (app/pipeline.ts), que son
 * puras y están testeadas. Acá sólo se dibuja.
 *
 * Las etapas 4 y 5 comparten este escenario. En la 4 el bloque de consecuencia
 * está en espera —que es el estado real mientras el executor corre— y en la 5
 * aterriza. El expediente NO se desmonta entre una y otra: gana su último
 * bloque. Ahí está la diferencia con dos carriles separados.
 */

export interface ExpedienteProps {
  funnel: Funnel
  /** Encabezado del caso: qué detectó y sobre quién. */
  caso: {
    entityId: string
    entityLabel: string
    ruleId: string
    ruleDescription: string
    severidad: string
    evidencia: { label: string; value: string }[]
  } | null
  ballot: BallotRow[]
  wouldChangeIf: string | null
  /** `null` mientras la decisión está pendiente. */
  error: string | null
  consecuencia: {
    status: "pendiente" | "ok" | "fallo" | "omitida"
    detail: string | null
    source: "real" | "simulada"
  } | null
  /** Los otros casos de la corrida, para la regleta. */
  casos: { key: string; activo: boolean; onIr: () => void }[]
  /** El pie del Acto III. */
  children?: ReactNode
}

const ETIQUETA_CONSECUENCIA: Record<string, string> = {
  pendiente: "ejecutando…",
  ok: "ejecutada",
  fallo: "falló",
  omitida: "no se ejecutó nada",
}

export function Expediente({
  funnel,
  caso,
  ballot,
  wouldChangeIf,
  error,
  consecuencia,
  casos,
  children,
}: ExpedienteProps) {
  return (
    <section className="expediente" data-caso={caso ? "si" : "no"} aria-labelledby="expediente-titulo">
      <header className="expediente-cabeza">
        <h2 id="expediente-titulo" className="titulo-seccion">
          El expediente
        </h2>

        {/* EL EMBUDO. Lo que NO te mandó es el argumento. */}
        <p className="embudo">
          <span className="cifra">{funnel.events}</span> eventos{" "}
          <span className="punto">·</span> <span className="cifra">{funnel.intervals}</span>{" "}
          intervalos <span className="punto">·</span>{" "}
          <span className="cifra">{funnel.detections}</span> patrones{" "}
          <span className="punto">·</span>{" "}
          {/*
            El renglón de callados aparece SÓLO si hubo alguno, y no siempre los
            hay: medido, `volt` no suprime en ningún seed ni con 16 estaciones.
            No es un defecto — `cooldownKey` es `${ruleId}:${entityId}` y la demo
            evalúa UN solo instante, así que un par (regla, entidad) no puede
            colisionar consigo mismo. La supresión existe para callar la alerta
            repetida ENTRE ticks. `restaurant` sí suprime (3 a 8) porque su regla
            `rush` no lleva groupBy y choca dentro del mismo lote.

            Mostrar "0 callados" sería peor que no mostrarlo: invita a leer que
            el motor no filtra nada. Sin el renglón, el embudo igual narra el
            angostamiento de eventos a lo que llegó a una persona.
          */}
          {funnel.silenced > 0 && (
            <>
              <span className="embudo-callado">
                <span className="cifra">{funnel.silenced}</span> callados por repetidos
              </span>{" "}
              <span className="punto">·</span>{" "}
            </>
          )}
          <strong>
            <span className="cifra">{funnel.delivered}</span> llegaron a vos
          </strong>
          {/* El cupo NO se suma a los callados: no es el motor conteniéndose,
              es el tope de la demo. Renglón propio y sólo si hay alguno. */}
          {funnel.overCap > 0 && (
            <span className="embudo-cupo">
              <span className="cifra">{funnel.overCap}</span> quedaron fuera del cupo de la demo
            </span>
          )}
        </p>

        {casos.length > 1 && (
          <div className="regleta" role="group" aria-label="Casos de esta corrida">
            {casos.map((c, i) => (
              <button
                key={c.key}
                type="button"
                className="regleta-chip"
                data-action={`caso-${i + 1}`}
                aria-pressed={c.activo}
                onClick={c.onIr}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </header>

      {caso === null ? (
        /* No hubo nada que decidir. El silencio ES el resultado. */
        <p className="expediente-silencio" data-empty="expediente">
          Miró <span className="cifra">{funnel.intervals}</span> intervalos y{" "}
          <span className="cifra">{funnel.events}</span> eventos. Nada ameritó actuar.
        </p>
      ) : (
        <>
          <div className="caso-cabeza">
            <p className="caso-identidad">
              {/* El sustantivo del dominio va adelante del id: cambiar de
                  dominio y ver "mesa 7" donde decía "estación EVC-03" es la
                  tesis del proyecto ocurriendo a la vista. */}
              <span className="caso-entidad">{caso.entityLabel}</span>{" "}
              <span className="titulo">{caso.entityId}</span>{" "}
              <span className="etiqueta" data-rule={caso.ruleId}>
                {caso.ruleId}
              </span>{" "}
              <span className="etiqueta">severidad {caso.severidad}</span>
            </p>
            <p className="caso-regla">{caso.ruleDescription}</p>
            <dl className="caso-evidencia">
              {caso.evidencia.map((row) => (
                <div key={row.label} className="caso-dato">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {error !== null && (
            <p className="tarjeta-texto aviso" data-error="decision">
              No se pudo decidir: {error}. La boleta queda sin resolver.
            </p>
          )}

          {/* LA BOLETA. Siempre las tres, siempre en el orden del config.
              El escalonado lo maneja el CSS con --i; acá sólo se numera. */}
          <ol className="boleta">
            {ballot.map((fila, i) => (
              <li
                key={fila.actionId}
                className="boleta-fila"
                data-elegida={fila.status === "elegida" ? "si" : "no"}
                data-descartada={fila.status === "descartada" ? "si" : "no"}
                data-estado={fila.status}
                data-tipo={fila.actionType}
                style={{ "--i": i } as CSSProperties}
              >
                <p className="boleta-cabeza">
                  <span className="boleta-marca" aria-hidden="true" />
                  <span className="titulo">{fila.actionId}</span>{" "}
                  {/* El type visible es lo que hace evidente que no todas
                      "mandan un mensaje": state_mutation cambia el mundo. */}
                  <span className="etiqueta" data-tipo={fila.actionType}>
                    {fila.actionType}
                  </span>
                </p>
                <p className="boleta-descripcion">{fila.description}</p>
                {fila.reason !== null && <p className="boleta-motivo">{fila.reason}</p>}
                {fila.message !== null && (
                  <blockquote className="boleta-mensaje">{fila.message}</blockquote>
                )}
              </li>
            ))}
          </ol>

          {wouldChangeIf !== null && (
            <p className="contrafactual" style={{ "--i": ballot.length } as CSSProperties}>
              {wouldChangeIf}
            </p>
          )}

          {consecuencia !== null && (
            <p
              className="consecuencia"
              data-consecuencia={consecuencia.status}
              data-source={consecuencia.source}
            >
              <span className="consecuencia-rotulo">
                {ETIQUETA_CONSECUENCIA[consecuencia.status] ?? consecuencia.status}
              </span>
              {consecuencia.detail !== null && (
                <span className="consecuencia-detalle">{consecuencia.detail}</span>
              )}
              {consecuencia.source === "simulada" && (
                <span className="pildora" data-modo="simulada">
                  simulada
                </span>
              )}
            </p>
          )}
        </>
      )}

      {children}
    </section>
  )
}
