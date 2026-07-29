import type { CSSProperties, ReactNode } from "react"
import type { BallotRow, Funnel } from "./pipeline.js"
import { useVidrio } from "./vidrio-liquido.js"

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
  /*
   * Las dos superficies de vidrio del expediente: los chips de la regleta y el
   * panel del encabezado del caso.
   *
   * `refraccion: 0` en las dos, a propósito. Se apoyan en `.hoja`, no sobre el
   * campo de líneas: no hay fondo con estructura que doblar, y emitir el
   * filtro costaría cuadros por un efecto que nadie puede ver. Las pestañas
   * —el otro vidrio interactivo de la página— tampoco refractan; sólo el
   * marco del hero lo hace.
   */
  const chip = useVidrio({
    clase: "regleta-chip",
    tinte: 0.34,
    radio: "var(--radio-pildora)",
    desenfoque: "10px",
  })
  const panel = useVidrio({
    clase: "caso-vidrio",
    tinte: 0.3,
    radio: "var(--radio-tarjeta)",
    desenfoque: "10px",
  })

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
            <span className="cifra">{funnel.delivered}</span> llegaron a ti
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
            {/* Cada botón ES una superficie de vidrio. Por eso `useVidrio` es
                un hook y no un componente envolvente: con un wrapper habría
                que elegir entre el vidrio y el botón, y el estado —hover,
                foco, aria-pressed— vive en el botón. */}
            {casos.map((c, i) => (
              <button
                key={c.key}
                type="button"
                {...chip.vidrio}
                data-action={`caso-${i + 1}`}
                aria-label={`Caso ${i + 1}`}
                aria-pressed={c.activo}
                onClick={c.onIr}
              >
                {chip.capas}
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
          <div {...panel.vidrio}>
            {panel.capas}
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
              <dl className="caso-evidencia">
                {caso.evidencia.map((row) => (
                  <div key={row.label} className="caso-dato">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              {/* La regla baja al pie del renglón: la identidad y las medidas
                  mandan, la descripción acompaña. */}
              <p className="caso-regla">{caso.ruleDescription}</p>
            </div>
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
                aria-current={fila.status === "elegida" ? "true" : undefined}
                data-elegida={fila.status === "elegida" ? "si" : "no"}
                data-descartada={fila.status === "descartada" ? "si" : "no"}
                data-estado={fila.status}
                data-tipo={fila.actionType}
                /* Sólo la ganadora lleva borde vivo. El efecto de page.tsx
                   recorre `[data-borde-vivo]` en todo el documento y le
                   escribe a cada uno la posición del cursor relativa a sí
                   mismo, así que basta el atributo: no hay props que pasar. */
                data-borde-vivo={fila.status === "elegida" ? "" : undefined}
                style={{ "--i": i } as CSSProperties}
              >
                {/*
                  La boleta entera significa cuál ganó y cuáles no. Sin este
                  renglón, ese significado viaja sólo en el color y en el glifo
                  que el CSS pinta sobre `.boleta-marca` — un span aria-hidden —
                  así que para un lector de pantalla no viaja. `.rotulo-seccion`
                  (globals.css) es el mismo recorte de 1px que ya usa la página
                  para texto que existe sólo para el lector.
                */}
                <span className="rotulo-seccion">
                  {fila.status === "elegida"
                    ? "Acción elegida:"
                    : fila.status === "descartada"
                      ? "Acción descartada:"
                      : "Sin resolver:"}
                </span>
                <p className="boleta-cabeza">
                  <span className="boleta-marca" aria-hidden="true" />
                  <span className="titulo">{fila.actionId}</span>{" "}
                  {/* El type visible es lo que hace evidente que no todas
                      "mandan un mensaje": state_mutation cambia el mundo. */}
                  <span className="etiqueta" data-tipo={fila.actionType}>
                    {fila.actionType}
                  </span>
                </p>
                {/*
                  Los tres textos son de NATURALEZA distinta y sin rótulo se
                  leen como tres párrafos iguales: uno sale del config, otro
                  del juicio del modelo, y el tercero es lo único que una
                  persona va a ver de verdad. El caso más filoso es `reason`,
                  que es UN solo campo con dos significados opuestos según la
                  fila: por qué la eligió, o por qué la descartó. El rótulo es
                  lo que lo desambigua.
                */}
                <p className="boleta-descripcion">
                  <span className="boleta-rotulo">qué hace</span>
                  {fila.description}
                </p>
                {fila.reason !== null && (
                  <p className="boleta-motivo">
                    <span className="boleta-rotulo">
                      {fila.status === "elegida" ? "por qué la eligió" : "por qué no"}
                    </span>
                    {fila.reason}
                  </p>
                )}
                {fila.message !== null && (
                  <>
                    <span className="boleta-rotulo">lo que va a leer una persona</span>
                    <blockquote className="boleta-mensaje">{fila.message}</blockquote>
                  </>
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
