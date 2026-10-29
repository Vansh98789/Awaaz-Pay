import React from 'react';

interface BrailleCellsProps {
  totalCells?: number;
  activeCells?: number;
  label?: string; // Screen reader accessible text
  className?: string;
}

export const BrailleCells: React.FC<BrailleCellsProps> = ({
  totalCells = 4,
  activeCells = 1,
  label = 'Progress indicator',
  className = '',
}) => {
  // Each cell is 2 columns x 3 rows of dots
  const dotCoords = [
    { x: 3, y: 3 },  // top-left
    { x: 3, y: 9 },  // mid-left
    { x: 3, y: 15 }, // bot-left
    { x: 9, y: 3 },  // top-right
    { x: 9, y: 9 },  // mid-right
    { x: 9, y: 15 }, // bot-right
  ];

  const cellWidth = 14;
  const cellHeight = 20;
  const cellGap = 8;
  const totalWidth = totalCells * cellWidth + (totalCells - 1) * cellGap;

  const accessibleText = label || `Step ${activeCells} of ${totalCells}`;

  return (
    <div
      className={`braille-progress-container ${className}`}
      role="progressbar"
      aria-label={accessibleText}
      aria-valuenow={activeCells}
      aria-valuemin={0}
      aria-valuemax={totalCells}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <svg
        width={totalWidth}
        height={cellHeight}
        viewBox={`0 0 ${totalWidth} ${cellHeight}`}
        aria-hidden="true"
        style={{ overflow: 'visible' }}
      >
        {Array.from({ length: totalCells }, (_, cellIndex) => {
          const isFilled = cellIndex < activeCells;
          const xOffset = cellIndex * (cellWidth + cellGap);

          return (
            <g key={cellIndex} transform={`translate(${xOffset}, 0)`}>
              {dotCoords.map((coord, dIndex) => {
                // If cell is filled, all 6 dots are solid; if current, partial or pulsating
                const isDotActive = isFilled;

                return (
                  <circle
                    key={dIndex}
                    cx={coord.x}
                    cy={coord.y}
                    r={isDotActive ? 2.2 : 1.6}
                    fill={isDotActive ? 'var(--accent)' : 'var(--border)'}
                    opacity={isDotActive ? 1 : 0.4}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {accessibleText}
      </span>
    </div>
  );
};
