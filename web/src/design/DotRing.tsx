import React from 'react';
import './DotRing.css';

export type DotRingState = 'idle' | 'listening' | 'speaking' | 'success' | 'blocked';

interface DotRingProps {
  state: DotRingState;
  dotCount?: number;
  radius?: number; // Distance from center
  children?: React.ReactNode;
  className?: string;
}

export const DotRing: React.FC<DotRingProps> = ({
  state = 'idle',
  dotCount = 24,
  radius = 130,
  children,
  className = '',
}) => {
  const dots = Array.from({ length: dotCount }, (_, i) => i);
  const size = (radius + 20) * 2;

  return (
    <div className={`dot-ring-container state-${state} ${className}`}>
      <svg
        className="dot-ring-svg"
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        width={size}
        height={size}
      >
        <g transform={`translate(${size / 2}, ${size / 2})`}>
          {dots.map((i) => {
            const angle = (i * 2 * Math.PI) / dotCount - Math.PI / 2;
            const cx = radius * Math.cos(angle);
            const cy = radius * Math.sin(angle);
            const delay = (i / dotCount) * 1.2;

            return (
              <circle
                key={i}
                className={`ring-dot dot-${i}`}
                cx={cx}
                cy={cy}
                r={4}
                style={{
                  animationDelay: `${delay}s`,
                }}
              />
            );
          })}
        </g>
      </svg>
      <div className="dot-ring-center">{children}</div>
    </div>
  );
};
