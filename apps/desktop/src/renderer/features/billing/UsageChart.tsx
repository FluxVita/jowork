import { useMemo } from 'react';

interface UsageDay {
  date: string;
  credits: number;
}

interface UsageChartProps {
  data: UsageDay[];
  limit: number;
}

/** Simple bar chart showing daily credit usage over last 7 days. */
export function UsageChart({ data, limit }: UsageChartProps) {
  const maxCredits = useMemo(() => {
    const maxData = Math.max(...data.map((d) => d.credits), 0);
    return Math.max(maxData, limit, 1);
  }, [data, limit]);

  return (
    <div className="bg-surface rounded-lg p-4">
      <h3 className="text-sm font-medium mb-3">Daily Usage (7 days)</h3>
      <div className="flex items-end gap-1.5 h-32">
        {data.map((day) => {
          const heightPct = (day.credits / maxCredits) * 100;
          const overLimit = day.credits > limit;
          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-text-secondary">{day.credits}</span>
              <div className="w-full bg-surface-2 rounded-t relative flex-1 flex items-end">
                <div
                  className={`w-full rounded-t transition-all ${overLimit ? 'bg-red-500' : 'bg-accent'}`}
                  style={{ height: `${heightPct}%`, minHeight: day.credits > 0 ? '2px' : '0' }}
                />
              </div>
              <span className="text-[10px] text-text-secondary">
                {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
            </div>
          );
        })}
      </div>
      {limit > 0 && (
        <div className="text-xs text-text-secondary mt-2 text-right">
          Limit: {limit}/day
        </div>
      )}
    </div>
  );
}
