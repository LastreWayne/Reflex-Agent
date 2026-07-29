// REFERENCIA — pegado por el humano el 2026-07-27. NO es código del proyecto.
//
// El dock estilo macOS: los ítems se agrandan según la DISTANCIA del cursor a
// cada uno. El de al lado crece un poco, el siguiente menos. Eso es lo que le
// da el carácter — no es un hover binario.
//
// El humano lo quiere para las cinco pestañas de los caminos: cortas cuando
// están dormidas, y que se abran al tamaño normal cuando se interactúa.
//
// CÓMO SE ADAPTA SIN framer-motion:
//
//   El efecto necesita JS — hay que saber dónde está el cursor respecto de
//   cada ítem. Pero son ~15 líneas:
//
//     1. un listener de pointermove sobre la tira
//     2. por cada ítem: dist = |cursorX − centroDelÍtem|
//     3. se escribe una custom property en el ítem: el.style.setProperty('--cerca', v)
//        donde v va de 1 (cursor encima) a 0 (lejos), con un radio de corte
//     4. el CSS hace el resto: width: calc(base + var(--cerca) * crecimiento)
//        con una transición corta
//
//   Lo único que se pierde sin librería de springs es el REBOTE al asentarse.
//   Se aproxima con una cubic-bezier con overshoot, p.ej.
//   cubic-bezier(.34, 1.56, .64, 1). Si queda muerto, avisar antes de instalar
//   nada.
//
//   pointermove va con { passive: true } y el cálculo cacheado en un rAF —
//   escribir estilos por ítem en cada evento de mouse sin agrupar es cómo se
//   pierden los 60fps que ya costó conseguir.
//
// ⚠️ ACCESIBILIDAD: el dock original expande sólo con hover del mouse. Las
// pestañas del proyecto tienen que abrirse también con :focus-visible y con
// tap. Y respetar prefers-reduced-motion.

'use client';

import {
  motion, MotionValue, useMotionValue, useSpring, useTransform,
  type SpringOptions, AnimatePresence,
} from 'framer-motion';
import {
  Children, cloneElement, createContext, useContext,
  useEffect, useMemo, useRef, useState,
} from 'react';
import { cn } from '@/lib/utils';

const DOCK_HEIGHT = 128;
const DEFAULT_MAGNIFICATION = 80;
const DEFAULT_DISTANCE = 150;
const DEFAULT_PANEL_HEIGHT = 64;

const DockContext = createContext(undefined);

function useDock() {
  const context = useContext(DockContext);
  if (!context) throw new Error('useDock must be used within an DockProvider');
  return context;
}

function Dock({
  children, className,
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  panelHeight = DEFAULT_PANEL_HEIGHT,
}) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(
    () => Math.max(DOCK_HEIGHT, magnification + magnification / 2 + 4),
    [magnification]
  );

  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  return (
    <motion.div style={{ height }} className='mx-2 flex max-w-full items-end overflow-x-auto'>
      <motion.div
        onMouseMove={({ pageX }) => { isHovered.set(1); mouseX.set(pageX); }}
        onMouseLeave={() => { isHovered.set(0); mouseX.set(Infinity); }}
        className={cn('mx-auto flex w-fit gap-4 rounded-2xl bg-gray-50 px-4', className)}
        style={{ height: panelHeight }}
        role='toolbar'
      >
        <DockContext.Provider value={{ mouseX, spring, distance, magnification }}>
          {children}
        </DockContext.Provider>
      </motion.div>
    </motion.div>
  );
}

// ── EL CORAZÓN DEL EFECTO: distancia del cursor → ancho del ítem ──
function DockItem({ children, className }) {
  const ref = useRef(null);
  const { distance, magnification, mouseX, spring } = useDock();
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (val) => {
    const domRect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - domRect.x - domRect.width / 2;
  });

  const widthTransform = useTransform(
    mouseDistance, [-distance, 0, distance], [40, magnification, 40]
  );
  const width = useSpring(widthTransform, spring);

  return (
    <motion.div
      ref={ref}
      style={{ width }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      className={cn('relative inline-flex items-center justify-center', className)}
      tabIndex={0}
      role='button'
    >
      {Children.map(children, (child) => cloneElement(child, { width, isHovered }))}
    </motion.div>
  );
}

function DockLabel({ children, className, ...rest }) {
  const isHovered = rest['isHovered'];
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = isHovered.on('change', (latest) => setIsVisible(latest === 1));
    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn('absolute -top-6 left-1/2 w-fit rounded-md px-2 py-0.5 text-xs', className)}
          role='tooltip'
          style={{ x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DockIcon({ children, className, ...rest }) {
  const width = rest['width'];
  const widthTransform = useTransform(width, (val) => val / 2);
  return (
    <motion.div style={{ width: widthTransform }} className={cn('flex items-center justify-center', className)}>
      {children}
    </motion.div>
  );
}

export { Dock, DockIcon, DockItem, DockLabel };
