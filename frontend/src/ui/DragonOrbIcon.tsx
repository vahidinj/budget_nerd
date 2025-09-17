import React from 'react';

interface DragonOrbIconProps {
  size?: number;
  className?: string;
}

// A stylized "dragon orb" icon (generic orange sphere with stars) to avoid direct IP usage.
export const DragonOrbIcon: React.FC<DragonOrbIconProps> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    className={className || ''}
  >
    <defs>
      <radialGradient id="orbGrad" cx="50%" cy="35%" r="65%">
        <stop offset="0%" stopColor="var(--accent-warm)" stopOpacity={0.95} />
        <stop offset="45%" stopColor="var(--accent)" />
        <stop offset="85%" stopColor="color-mix(in srgb, var(--accent) 80%, #000 20%)" />
      </radialGradient>
      <linearGradient id="rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-warm) 80%, var(--accent) 20%)" />
        <stop offset="50%" stopColor="var(--accent)" />
        <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 60%, #5a2d00 40%)" />
      </linearGradient>
      <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  <circle cx="32" cy="32" r="29" fill="url(#orbGrad)" stroke="url(#rim)" strokeWidth="2" filter="url(#glow)" />
  {/* Six stars: two staggered rows of three */}
  <g fill="color-mix(in srgb, var(--accent) 60%, #b32000 40%)" transform="translate(32 32) scale(0.85)">
      {/* Top row */}
      <Star x={-12} y={-8} />
      <Star x={0} y={-10} />
      <Star x={12} y={-8} />
      {/* Bottom row */}
      <Star x={-12} y={8} />
      <Star x={0} y={10} />
      <Star x={12} y={8} />
    </g>
  </svg>
);

interface StarProps { x: number; y: number; }
const Star: React.FC<StarProps> = ({ x, y }) => (
  <path transform={`translate(${x} ${y}) scale(0.9)`} d="M4.5 0l1.4 3.6 3.9.3-3 2.5.95 3.8-3.25-2-3.25 2 .95-3.8-3-2.5 3.9-.3z" />
);

export default DragonOrbIcon;
