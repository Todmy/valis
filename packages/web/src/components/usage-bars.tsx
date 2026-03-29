/**
 * Horizontal progress bar for displaying usage quotas.
 * Dark mode styling: bg-gray-800 track, colored fill.
 */

'use client';

interface UsageBarProps {
  label: string;
  current: number;
  max: number;
  color?: string;
}

export function UsageBar({ label, current, max, color = 'bg-blue-500' }: UsageBarProps) {
  const pct = max > 0 ? Math.min(Math.round((current / max) * 100), 100) : 0;
  const isWarning = pct > 80;
  const fillColor = isWarning ? 'bg-amber-500' : color;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="font-medium text-gray-100">
          {current} / {max}
        </span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full transition-all ${fillColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
