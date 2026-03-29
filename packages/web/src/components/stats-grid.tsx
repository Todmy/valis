/**
 * T033: Stats grid component for the dashboard.
 */

'use client';

interface StatItem {
  label: string;
  value: string | number;
  /** Optional link to navigate to on click. */
  href?: string;
  /** Optional color variant. */
  variant?: 'default' | 'warning' | 'success' | 'info';
}

interface StatsGridProps {
  items: StatItem[];
}

const VARIANT_STYLES = {
  default: 'bg-gray-900',
  warning: 'bg-yellow-950 border-yellow-800',
  success: 'bg-green-950 border-green-800',
  info: 'bg-blue-950 border-blue-800',
};

export function StatsGrid({ items }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => {
        const style = VARIANT_STYLES[item.variant ?? 'default'];
        const content = (
          <div
            key={item.label}
            className={`border border-gray-800 rounded-lg p-4 ${style}`}
          >
            <div className="text-2xl font-bold text-gray-100">{item.value}</div>
            <div className="text-sm text-gray-400 mt-1">{item.label}</div>
          </div>
        );

        if (item.href) {
          return (
            <a key={item.label} href={item.href} className="block hover:shadow-md transition-shadow rounded-lg">
              {content}
            </a>
          );
        }
        return <div key={item.label}>{content}</div>;
      })}
    </div>
  );
}
