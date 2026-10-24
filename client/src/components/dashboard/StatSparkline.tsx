import { memo } from 'react';

type StatSparklineProps = {
  color: 'blue' | 'green' | 'red' | 'cyan' | 'orange';
  className?: string;
};

const colorConfig = {
  blue: {
    stroke: '#3b82f6',
    gradientId: 'sparkline-blue',
    stopColor: '#3b82f6',
  },
  green: {
    stroke: '#10b981',
    gradientId: 'sparkline-green',
    stopColor: '#10b981',
  },
  red: {
    stroke: '#f43f5e',
    gradientId: 'sparkline-red',
    stopColor: '#f43f5e',
  },
  cyan: {
    stroke: '#06b6d4',
    gradientId: 'sparkline-cyan',
    stopColor: '#06b6d4',
  },
  orange: {
    stroke: '#f97316',
    gradientId: 'sparkline-orange',
    stopColor: '#f97316',
  },
};

function StatSparkline({ color, className = 'w-full h-8' }: StatSparklineProps) {
  const cfg = colorConfig[color] || colorConfig.blue;

  return (
    <svg viewBox="0 0 120 28" fill="none" className={className} preserveAspectRatio="none">
      <defs>
        <linearGradient id={cfg.gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cfg.stopColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={cfg.stopColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path
        d="M0 24 C 20 24, 30 18, 50 19 C 70 20, 85 8, 100 12 C 110 14, 115 6, 120 4 L 120 28 L 0 28 Z"
        fill={`url(#${cfg.gradientId})`}
      />
      <path
        d="M0 24 C 20 24, 30 18, 50 19 C 70 20, 85 8, 100 12 C 110 14, 115 6, 120 4"
        stroke={cfg.stroke}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export default memo(StatSparkline);
