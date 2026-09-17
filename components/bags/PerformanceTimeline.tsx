'use client';

import { useMemo, useState } from 'react';
import { Bag } from '@/types';
import { TIME_RANGES, TimeRange, generatePerformanceSeries } from '@/lib/performance-series';

interface PerformanceTimelineProps {
  bag: Bag;
}

export function PerformanceTimeline({ bag }: PerformanceTimelineProps) {
  const [range, setRange] = useState<TimeRange>('30D');

  const series = useMemo(
    () =>
      generatePerformanceSeries(
        bag.id,
        range,
        bag.performance7d,
        bag.performance30d,
        bag.performanceYtd
      ),
    [bag.id, range, bag.performance7d, bag.performance30d, bag.performanceYtd]
  );

  const isPositive = series.changePct >= 0;
  const width = 640;
  const height = 200;
  const padding = 10;

  const values = series.points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;

  const coords = series.points.map((p, i) => {
    const x = padding + (i / (series.points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((p.value - min) / span) * (height - padding * 2);
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const zeroY = height - padding - ((0 - min) / span) * (height - padding * 2);
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padding} L ${padding} ${height - padding} Z`;

  const lineColor = isPositive ? '#00D084' : '#E0847A';

  return (
    <div className="perf-timeline">
      <div className="perf-range-row">
        {TIME_RANGES.map((r) => (
          <button
            key={r}
            className={`perf-range-btn ${range === r ? 'active' : ''}`}
            onClick={() => setRange(r)}
          >
            {r === 'ALL' ? 'All Time' : r}
          </button>
        ))}
      </div>

      <div className="perf-headline">
        <span className={`val ${isPositive ? 'pos' : 'neg'}`}>
          {isPositive ? '+' : ''}
          {series.changePct.toFixed(2)}%
        </span>
        <span className="sub">{range === 'ALL' ? 'since inception' : `past ${range.toLowerCase()}`}</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${bag.id}-${range}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
        <path d={areaPath} fill={`url(#grad-${bag.id}-${range})`} stroke="none" />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className="perf-stats-row">
        <div className="perf-stat">
          High
          <b>+{series.high.toFixed(2)}%</b>
        </div>
        <div className="perf-stat">
          Low
          <b>{series.low.toFixed(2)}%</b>
        </div>
        <div className="perf-stat">
          TVL
          <b>${bag.tvl.toLocaleString()}</b>
        </div>
      </div>
    </div>
  );
}
