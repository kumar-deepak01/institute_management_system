import { memo, useMemo, useState } from 'react';

type DataItem = { label: string; count: number };

type Props = {
  data: DataItem[];
  demographic: 'Gender' | 'States' | 'Cities';
};

const sliceColors = [
  '#f97316', // brand orange
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f43f5e', // rose
  '#64748b', // slate
];

function DemographicsDonutChart({ data, demographic }: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const validData = useMemo(() => {
    return (data || []).filter(item => item && item.count > 0);
  }, [data]);

  const total = useMemo(() => {
    return validData.reduce((sum, item) => sum + item.count, 0);
  }, [validData]);

  if (!validData.length || total === 0) {
    return (
      <div className="grid h-[240px] place-content-center text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-500 dark:bg-orange-950/40 dark:text-orange-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
            />
          </svg>
        </span>
        <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">
          No {demographic.toLowerCase()} data recorded
        </p>
        <p className="mt-1 max-w-xs text-xs text-slate-400 dark:text-slate-500">
          Student demographic information will populate here as enrollments are added.
        </p>
      </div>
    );
  }

  // Calculate donut segments
  const size = 180;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativePercent = 0;
  const segments = validData.map((item, index) => {
    const percent = item.count / total;
    const strokeDasharray = `${percent * circumference} ${circumference}`;
    const strokeDashoffset = -cumulativePercent * circumference;
    cumulativePercent += percent;
    const color = sliceColors[index % sliceColors.length];
    return {
      ...item,
      percent: Math.round(percent * 100),
      strokeDasharray,
      strokeDashoffset,
      color,
      index,
    };
  });

  const activeSegment = hoveredIndex !== null ? segments[hoveredIndex] : null;

  return (
    <div className="flex min-h-[235px] flex-col items-center justify-center gap-6 sm:flex-row sm:gap-8">
      {/* Donut Chart SVG */}
      <div className="relative flex shrink-0 items-center justify-center">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="animate-donut-spin transition-transform duration-300"
          style={{ transformOrigin: 'center' }}
        >
          {/* Background circle track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-slate-100 dark:text-slate-800"
            strokeWidth={strokeWidth}
          />

          {/* Slices */}
          {segments.map(seg => {
            const isHovered = hoveredIndex === seg.index;
            return (
              <circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={seg.strokeDasharray}
                strokeDashoffset={seg.strokeDashoffset}
                strokeLinecap="butt"
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHoveredIndex(seg.index)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>

        {/* Center label */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-black text-slate-800 dark:text-white">
            {activeSegment ? activeSegment.count : total}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {activeSegment ? activeSegment.label : 'Total'}
          </span>
        </div>
      </div>

      {/* Legend & Details */}
      <div className="flex flex-col justify-center space-y-2.5">
        {segments.map(seg => {
          const isHovered = hoveredIndex === seg.index;
          return (
            <button
              key={seg.label}
              type="button"
              onMouseEnter={() => setHoveredIndex(seg.index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-left text-sm font-semibold transition-all duration-150 ${
                isHovered
                  ? 'bg-slate-100 shadow-sm dark:bg-slate-800'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-md transition-transform duration-200"
                style={{
                  backgroundColor: seg.color,
                  transform: isHovered ? 'scale(1.2)' : 'scale(1)',
                }}
              />
              <span className="capitalize text-slate-700 dark:text-slate-300">{seg.label}</span>
              <span className="ml-auto pl-4 font-bold text-slate-900 dark:text-white">{seg.count}</span>
              <span className="text-xs font-medium text-slate-400">({seg.percent}%)</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(DemographicsDonutChart);

