import React from 'react';

interface DotWordmarkProps {
  size?: number; // scale multiplier or width
  className?: string;
}

// 5x7 Dot patterns for "awaaz"
// 0 = empty, 1 = dot
const LETTERS: Record<string, number[][]> = {
  a: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 1],
  ],
  w: [
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 1, 1],
    [1, 0, 0, 0, 1],
  ],
  z: [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ],
};

const WORD = ['a', 'w', 'a', 'a', 'z'];

export const DotWordmark: React.FC<DotWordmarkProps> = ({ size = 180, className = '' }) => {
  const dotRadius = 1.8;
  const colPitch = 5.2;
  const rowPitch = 5.2;
  const letterSpacing = 4.5;
  const letterWidth = 4 * colPitch; // 5 columns (0..4)

  const totalWidth = WORD.length * letterWidth + (WORD.length - 1) * letterSpacing;
  const totalHeight = 6 * rowPitch;

  return (
    <svg
      role="img"
      aria-label="Awaaz Pay"
      viewBox={`0 0 ${totalWidth + 4} ${totalHeight + 4}`}
      width={size}
      height={(size * (totalHeight + 4)) / (totalWidth + 4)}
      className={`dot-wordmark ${className}`}
      style={{ display: 'inline-block', overflow: 'visible' }}
    >
      <title>Awaaz Pay</title>
      <g transform="translate(2, 2)">
        {WORD.map((char, lIndex) => {
          const pattern = LETTERS[char] || LETTERS['a'];
          const xOffset = lIndex * (letterWidth + letterSpacing);

          return (
            <g key={`${char}-${lIndex}`} transform={`translate(${xOffset}, 0)`}>
              {pattern.map((row, rIndex) =>
                row.map((val, cIndex) => {
                  if (!val) return null;
                  return (
                    <circle
                      key={`${rIndex}-${cIndex}`}
                      cx={cIndex * colPitch}
                      cy={rIndex * rowPitch}
                      r={dotRadius}
                      fill="var(--text)"
                    />
                  );
                })
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
};
