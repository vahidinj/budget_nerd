import React, { useState } from 'react';

type Props = {
  size?: number; // px
  themeColor?: string; // primary hair/body gradient color, hex or CSS color
  className?: string;
};

export const MascotIcon: React.FC<Props> = ({ size = 44, themeColor = '#ffd36b', className }) => {
  const [isSaiyan, setIsSaiyan] = useState(false);
  const w = size;
  const h = size;

  // Animation lasts 1.1s, then resets
  const handleClick = () => {
    if (!isSaiyan) {
      setIsSaiyan(true);
      setTimeout(() => setIsSaiyan(false), 1100);
    }
  };

  return (
    <svg
      className={`mascot-icon${isSaiyan ? ' mascot-saiyan-glow' : ''}${className ? ' ' + className : ''}`}
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={h}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      <defs>
        <linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={themeColor} />
          <stop offset="1" stopColor="#ff9b6b" />
        </linearGradient>
        <linearGradient id="g2" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      {/* Super Saiyan hair (larger, golden spikes) */}
      <g fill="#f6c84c" stroke="#a86b0d" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 22c4-10 10-16 22-16 7 0 13 3 18 8-3-6-8-10-18-10-12 0-18 8-22 18z" />
        <path d="M6 26c5-8 10-12 18-14-6 1-12 6-16 12-1 2-1 3-2 2z" transform="translate(2,0)" />
        <path d="M52 20c2 0 6-2 8-5-1 4-3 7-6 9-1-2-1-3-2-4z" />
      </g>

      {/* Head */}
      <circle cx="32" cy="36" r="16" fill="url(#g1)" stroke="#2b2b2b" strokeWidth="1.5" />

      {/* Hair shadow + inner spikes to give anime look */}
      <g fill="#c48316" opacity="0.95">
        <path d="M14 22c3-6 8-10 18-10s15 4 18 10c-4-5-9-8-18-8s-14 3-18 8z" />
      </g>

      {/* Glasses frames (translucent lenses) */}
      <g>
        <rect x="16" y="30" width="14" height="9" rx="3" fill="#0b1320" opacity="0.12" />
        <rect x="34" y="30" width="14" height="9" rx="3" fill="#0b1320" opacity="0.12" />
        <path d="M30 34h4" stroke="#0b1320" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
        <rect x="17" y="31" width="12" height="7" rx="2" fill="none" stroke="#0b1320" strokeWidth="1.2" opacity="0.9" />
        <rect x="35" y="31" width="12" height="7" rx="2" fill="none" stroke="#0b1320" strokeWidth="1.2" opacity="0.9" />
      </g>

      {/* Eyes (smaller, softer pupils) */}
      <circle cx="26" cy="34" r="0.85" fill="#121212" opacity="0.95" />
      <circle cx="38" cy="34" r="0.85" fill="#121212" opacity="0.95" />
      <circle cx="26" cy="34" r="0.35" fill="#ffffff" opacity="0.9" />
      <circle cx="38" cy="34" r="0.35" fill="#ffffff" opacity="0.9" />

      {/* Cheek blush */}
      <ellipse cx="24" cy="41" rx="2.6" ry="1.3" fill="#ffb0b0" opacity="0.9" />
      <ellipse cx="40" cy="41" rx="2.6" ry="1.3" fill="#ffb0b0" opacity="0.9" />

      {/* Mouth (small smirk) */}
      <path d="M27 43c1 1.2 3 1.2 4 0" stroke="#2b2b2b" strokeWidth="1.6" strokeLinecap="round" fill="none" />

      {/* DBZ nod - Headband star */}
      <path d="M45 22l3-4 2.2 4-3 2-2.2-2z" fill="#fff" opacity="0.95" />

      {/* Glasses sheen */}
      <path d="M20 31c1-0.5 3-1 5-0.8" stroke="url(#g2)" strokeWidth="1.0" strokeLinecap="round" fill="none" opacity="0.95" />
      {/* Super Saiyan Glow Overlay */}
      {isSaiyan && (
        <g>
          <circle
            cx="32"
            cy="36"
            r="20"
            fill="none"
            stroke="#ffe66a"
            strokeWidth="4"
            opacity="0.7"
            style={{ filter: 'drop-shadow(0 0 18px #ffe66a) drop-shadow(0 0 32px #ffe66a)' }}
          />
          <circle
            cx="32"
            cy="36"
            r="24"
            fill="none"
            stroke="#fff7b2"
            strokeWidth="2.5"
            opacity="0.35"
            style={{ filter: 'drop-shadow(0 0 32px #fff7b2)' }}
          />
        </g>
      )}
    </svg>
  );
};

export default MascotIcon;
