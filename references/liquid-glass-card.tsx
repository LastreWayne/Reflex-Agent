// REFERENCIA — pegado por el humano el 2026-07-27. NO es código del proyecto.
//
// La receta VISUAL de acá es lo valioso, y es CSS + SVG puro:
//
//   1. capa "bend"  → backdrop-filter: blur() + filter: url(#glass-blur)
//                     donde el filtro es feTurbulence + feDisplacementMap.
//                     Esto es lo que dobla el fondo en el borde (ver
//                     references/liquidglass2.png: el tallo de la flor se
//                     corre al cruzar el vidrio). Es LA diferencia entre
//                     liquid glass y un panel borroso.
//   2. capa "face"  → box-shadow externo suave (el halo)
//   3. capa "edge"  → box-shadow INSET en dos direcciones opuestas: es el
//                     filo brillante que se ve en las tres referencias.
//   4. contenido    → encima de todo
//
// framer-motion acá sólo maneja drag, click-para-expandir y scale en hover.
// Nada de eso hace falta: nuestras pestañas se abren por hover/focus/tap y no
// se arrastran. La receta visual no necesita la librería.
//
// ⚠️ DOS RIESGOS REALES AL ADAPTARLO:
//
//   · scale='200' en feDisplacementMap es ENORME. Con 72 paths animados
//     detrás, eso puede comerse el frame rate. Empezar mucho más abajo
//     (20–40) y medir.
//   · filter: url(#...) sobre un elemento que también usa backdrop-filter
//     rompe o recorta el backdrop en varios navegadores. Probar los dos
//     juntos TEMPRANO, no al final.

// @ts-nocheck
'use client';
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from "@/lib/utils"

interface LiquidGlassCardProps {
  children: React.ReactNode;
  className?: string;
  draggable?: boolean;
  expandable?: boolean;
  width?: string;
  height?: string;
  expandedWidth?: string;
  expandedHeight?: string;
  blurIntensity?: 'sm' | 'md' | 'lg' | 'xl';
  shadowIntensity?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  borderRadius?: string;
  glowIntensity?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const LiquidGlassCard = ({
  children,
  className = '',
  draggable = true,
  expandable = false,
  width,
  height,
  expandedWidth,
  expandedHeight,
  blurIntensity = 'xl',
  borderRadius = '32px',
  glowIntensity = 'sm',
  shadowIntensity = 'md',
  ...props
}: LiquidGlassCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleExpansion = (e) => {
    if (!expandable) return;
    if (e.target.closest('a, button, input, select, textarea')) return;
    setIsExpanded(!isExpanded);
  };

  const blurClasses = {
    sm: 'backdrop-blur-sm',
    md: 'backdrop-blur-md',
    lg: 'backdrop-blur-lg',
    xl: 'backdrop-blur-xl',
  };

  // ── EL FILO. Esto es lo que se ve en las tres referencias. ──
  const shadowStyles = {
    none: 'inset 0 0 0 0 rgba(255, 255, 255, 0)',
    xs: 'inset 1px 1px 1px 0 rgba(255, 255, 255, 0.3), inset -1px -1px 1px 0 rgba(255, 255, 255, 0.3)',
    sm: 'inset 2px 2px 2px 0 rgba(255, 255, 255, 0.35), inset -2px -2px 2px 0 rgba(255, 255, 255, 0.35)',
    md: 'inset 3px 3px 3px 0 rgba(255, 255, 255, 0.45), inset -3px -3px 3px 0 rgba(255, 255, 255, 0.45)',
    lg: 'inset 4px 4px 4px 0 rgba(255, 255, 255, 0.5), inset -4px -4px 4px 0 rgba(255, 255, 255, 0.5)',
    xl: 'inset 6px 6px 6px 0 rgba(255, 255, 255, 0.55), inset -6px -6px 6px 0 rgba(255, 255, 255, 0.55)',
  };

  const glowStyles = {
    none: '0 4px 4px rgba(0, 0, 0, 0.05), 0 0 12px rgba(0, 0, 0, 0.05)',
    xs: '0 4px 4px rgba(0, 0, 0, 0.15), 0 0 12px rgba(0, 0, 0, 0.08), 0 0 16px rgba(255, 255, 255, 0.05)',
    sm: '0 4px 4px rgba(0, 0, 0, 0.15), 0 0 12px rgba(0, 0, 0, 0.08), 0 0 24px rgba(255, 255, 255, 0.1)',
    md: '0 4px 4px rgba(0, 0, 0, 0.15), 0 0 12px rgba(0, 0, 0, 0.08), 0 0 32px rgba(255, 255, 255, 0.15)',
    lg: '0 4px 4px rgba(0, 0, 0, 0.15), 0 0 12px rgba(0, 0, 0, 0.08), 0 0 40px rgba(255, 255, 255, 0.2)',
    xl: '0 4px 4px rgba(0, 0, 0, 0.15), 0 0 12px rgba(0, 0, 0, 0.08), 0 0 48px rgba(255, 255, 255, 0.25)',
  };

  return (
    <>
      {/* ── EL FILTRO QUE DOBLA EL FONDO. Esto es liquid glass. ── */}
      <svg className='hidden'>
        <defs>
          <filter id='glass-blur' x='0' y='0' width='100%' height='100%'
                  filterUnits='objectBoundingBox'>
            <feTurbulence type='fractalNoise' baseFrequency='0.003 0.007'
                          numOctaves='1' result='turbulence' />
            <feDisplacementMap in='SourceGraphic' in2='turbulence'
                               scale='200'
                               xChannelSelector='R' yChannelSelector='G' />
          </filter>
        </defs>
      </svg>

      <motion.div className={cn('relative', className)} style={{ borderRadius }}>
        {/* bend */}
        <div className={`absolute inset-0 ${blurClasses[blurIntensity]} z-0`}
             style={{ borderRadius, filter: 'url(#glass-blur)' }} />
        {/* face */}
        <div className='absolute inset-0 z-10'
             style={{ borderRadius, boxShadow: glowStyles[glowIntensity] }} />
        {/* edge */}
        <div className='absolute inset-0 z-20'
             style={{ borderRadius, boxShadow: shadowStyles[shadowIntensity] }} />
        {/* contenido */}
        <div className='relative z-30'>{children}</div>
      </motion.div>
    </>
  );
};
