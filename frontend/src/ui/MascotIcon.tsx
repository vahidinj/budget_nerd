import React from 'react';

type Props = {
  size?: number; // px
  themeColor?: string; // primary hair/body gradient color, hex or CSS color
  className?: string;
};

export const MascotIcon: React.FC<Props> = ({ size = 48, themeColor = '#63d1ff', className }) => {
  const w = size;
  const h = size;

  return (
    <svg
      className={`mascot-icon${className ? ' ' + className : ''}`}
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={h}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="owlBody" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={themeColor} />
          <stop offset="100%" stopColor="#1b7fc9" />
        </linearGradient>
        <linearGradient id="owlFace" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#f7e3b6" />
          <stop offset="100%" stopColor="#e3c28f" />
        </linearGradient>
        <linearGradient id="owlHighlight" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#c9f0ff" />
          <stop offset="100%" stopColor="#9ad7ff" />
        </linearGradient>
        <linearGradient id="owlShadow" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#145a97" />
          <stop offset="100%" stopColor="#0d456f" />
        </linearGradient>
        <linearGradient id="owlBeak" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffd27f" />
          <stop offset="100%" stopColor="#ff9c45" />
        </linearGradient>
        <linearGradient id="owlWing" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#5fc7ff" />
          <stop offset="100%" stopColor="#1c6fb0" />
        </linearGradient>
        <filter id="owlGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="auraBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Owl mascot in the same bold, warm style as the orb icon */}
      <g transform="translate(-1 -2) scale(1.06)" stroke="#0a121c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" filter="url(#owlGlow)">
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 32 32; -4 32 32; 0 32 32; 3 32 32; 0 32 32"
          dur="8s"
          repeatCount="indefinite"
        />
        {/* Subtle aura */}
        <path
          d="M6 34c4-10 12-16 26-18 14 2 22 8 26 18-4 14-14 22-26 22S10 48 6 34z"
          fill="none"
          stroke="#63d1ff"
          strokeWidth="2"
          opacity="0.35"
          filter="url(#auraBlur)"
        />
        {/* Back wings */}
        <g fill="url(#owlWing)" stroke="#141414" strokeWidth="1.4">
          <path d="M8 38c5-9 14-12 23-9-4 3-6 7-7 12-7 1-11 3-16 7z" />
          <path d="M56 38c-5-9-14-12-23-9 4 3 6 7 7 12 7 1 11 3 16 7z" />
        </g>
        <g fill="none" stroke="#0e1a28" strokeWidth="1.2" opacity="0.7">
          <path d="M12 38c6-5 12-7 18-6" />
          <path d="M10 42c7-4 13-5 19-4" />
          <path d="M52 38c-6-5-12-7-18-6" />
          <path d="M54 42c-7-4-13-5-19-4" />
        </g>
        <circle cx="32" cy="30" r="18" fill="url(#owlBody)" />
        <ellipse cx="32" cy="44" rx="18" ry="15" fill="url(#owlBody)" />
        <path d="M20 22c6-5 14-6 20-2-4 1-7 3-10 6-4-2-7-3-10-4z" fill="url(#owlHighlight)" opacity="0.85" />
        <path d="M22 40c6-4 14-4 20 1-6 0-10 2-14 5-3-3-4-4-6-6z" fill="url(#owlHighlight)" opacity="0.75" />
        <path d="M36 36c5 0 10 3 12 7-4 1-8 2-12 1 2-3 2-5 0-8z" fill="url(#owlShadow)" opacity="0.8" />
        <path d="M38 22c4 1 8 4 9 8-4 1-7 1-10-1 1-3 1-5 1-7z" fill="url(#owlShadow)" opacity="0.75" />

        {/* Ear tufts */}
        <path d="M16 16l-6 9 12-3z" fill="url(#owlBody)" />
        <path d="M48 16l6 9-12-3z" fill="url(#owlBody)" />

        {/* Facial disk and belly patch */}
        <circle cx="23.5" cy="30" r="10.5" fill="url(#owlFace)" />
        <circle cx="40.5" cy="30" r="10.5" fill="url(#owlFace)" />
        <ellipse cx="32" cy="46" rx="10" ry="8.5" fill="url(#owlFace)" />

        {/* Eyes */}
        <circle cx="23.5" cy="30" r="6.6" fill="#ffffff" />
        <circle cx="40.5" cy="30" r="6.6" fill="#ffffff" />
        <circle cx="23.5" cy="31" r="2.5" fill="#1b1b1b" />
        <circle cx="40.5" cy="31" r="2.5" fill="#1b1b1b" />
        <circle cx="22.6" cy="29.2" r="0.9" fill="#ffffff" />
        <circle cx="39.6" cy="29.2" r="0.9" fill="#ffffff" />

        {/* Brow arc */}
        <path d="M16 20c4-3 9-4 14-3" fill="none" />
        <path d="M34 17c6-3 12-2 16 1" fill="none" />

        {/* Glasses */}
        <rect x="15" y="24" width="17" height="12" rx="4" fill="none" strokeWidth="2" />
        <rect x="32" y="24" width="17" height="12" rx="4" fill="none" strokeWidth="2" />
        <path d="M32 30h0" />

        {/* Wing tips */}
        <path d="M14 44c4-3 8-4 12-4" fill="none" stroke="#0b1622" opacity="0.75" />
        <path d="M50 44c-4-3-8-4-12-4" fill="none" stroke="#0b1622" opacity="0.75" />

        {/* Beak */}
        <path d="M28 35l4 7 4-7z" fill="url(#owlBeak)" />
        <path d="M32 35v7" fill="none" />

        {/* Feet */}
        <path d="M24 57l-3 4 5-1 1 2 2-1-2-4z" fill="#e3862d" />
        <path d="M40 57l3 4-5-1-1 2-2-1 2-4z" fill="#e3862d" />

        {/* Glasses shadow */}
        <path d="M17 36h10" fill="none" stroke="#141414" opacity="0.35" />
        <path d="M37 36h10" fill="none" stroke="#141414" opacity="0.35" />
      </g>
    </svg>
  );
};

export default MascotIcon;
