import { memo, useId, useState } from 'react';

type DataItem = { label: string; count: number };

type Props = {
  data: DataItem[];
};

function EnrollmentTrendChart({ data }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartId = useId();

  if (!data || data.length === 0 || !data.some(d => d.count > 0)) {
    return (
      <div className="grid h-[240px] place-content-center text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-500 dark:bg-orange-950/40 dark:text-orange-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </span>
        <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">No enrollment records yet</p>
        <p className="mt-1 max-w-xs text-xs text-slate-400 dark:text-slate-500">
          Enrolled students will appear here automatically across selected periods.
        </p>
      </div>
    );
  }

  const values = data.map(d => d.count);
  const max = Math.max(...values, 4);
  const width = 680;
  const height = 220;
  const paddingLeft = 45;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 40;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const points = data.map((item, index) => {
    const x = paddingLeft + (index / Math.max(1, data.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (item.count / max) * chartHeight;
    return { x, y, ...item };
  });

  // Construct smooth SVG path using cubic beziers
  let pathD = '';
  let areaD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cpX = (p0.x + p1.x) / 2;
      pathD += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    areaD = `${pathD} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;
  }

  const yTicks = [0, Math.round(max / 2), max];

  return (
    <div className="relative w-full overflow-hidden pt-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[230px] w-full select-none"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={`trend-grad-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
            <stop offset="80%" stopColor="#f43f5e" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
          </linearGradient>
          <style>{`
            @keyframes drawPath {
              0% { stroke-dashoffset: 1400; }
              100% { stroke-dashoffset: 0; }
            }
            .animate-line-draw {
              stroke-dasharray: 1400;
              stroke-dashoffset: 1400;
              animation: drawPath 1.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
          `}</style>
        </defs>

        {/* Horizontal grid lines */}
        {yTicks.map(val => {
          const y = paddingTop + chartHeight - (val / max) * chartHeight;
          return (
            <g key={val}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="currentColor"
                className="text-slate-100 dark:text-slate-800"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-semibold dark:fill-slate-500"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill={`url(#trend-grad-${chartId})`} className="transition-opacity duration-300" />

        {/* Animated line */}
        <path
          d={pathD}
          fill="none"
          stroke="#f43f5e"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-line-draw drop-shadow-sm"
        />

        {/* Vertical crosshair line on hover */}
        {hoverIndex !== null && points[hoverIndex] && (
          <line
            x1={points[hoverIndex].x}
            y1={paddingTop}
            x2={points[hoverIndex].x}
            y2={paddingTop + chartHeight}
            stroke="#f43f5e"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            className="opacity-70"
          />
        )}

        {/* Data points & X Labels */}
        {points.map((p, idx) => {
          const isHovered = hoverIndex === idx;
          return (
            <g key={`${p.label}-${idx}`}>
              {/* Invisible touch/hover target */}
              <rect
                x={p.x - 20}
                y={paddingTop}
                width="40"
                height={chartHeight + 20}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(idx)}
                onMouseLeave={() => setHoverIndex(null)}
              />

              {/* Point circle */}
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? 6 : 4}
                fill="#ffffff"
                stroke="#f43f5e"
                strokeWidth={isHovered ? 3.5 : 2.5}
                className="transition-all duration-200"
              />

              {/* X Axis Label */}
              <text
                x={p.x}
                y={height - 12}
                textAnchor="middle"
                className={`text-[10px] font-semibold transition-colors duration-200 ${
                  isHovered
                    ? 'fill-rose-600 font-bold dark:fill-rose-400'
                    : 'fill-slate-400 dark:fill-slate-500'
                }`}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Hover Floating Tooltip */}
      {hoverIndex !== null && points[hoverIndex] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-rose-200 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur dark:border-rose-900/60 dark:bg-slate-900/95"
          style={{
            left: `${(points[hoverIndex].x / width) * 100}%`,
            top: `${(points[hoverIndex].y / height) * 230 - 10}px`,
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {points[hoverIndex].label}
          </p>
          <p className="text-xs font-black text-rose-600 dark:text-rose-400">
            {points[hoverIndex].count} {points[hoverIndex].count === 1 ? 'Student' : 'Students'}
          </p>
        </div>
      )}
    </div>
  );
}

export default memo(EnrollmentTrendChart);
