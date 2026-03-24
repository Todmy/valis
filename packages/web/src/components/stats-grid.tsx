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
  default: 'bg-white',
  warning: 'bg-yellow-50 border-yellow-200',
  success: 'bg-green-50 border-green-200',
  info: 'bg-blue-50 border-blue-200',
};

export function StatsGrid({ items }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => {
        const style = VARIANT_STYLES[item.variant ?? 'default'];
        const content = (
          <div
            key={item.label}
            className={`border rounded-lg p-4 ${style}`}
          >
            <div className="text-2xl font-bold text-gray-900">{item.value}</div>
            <div className="text-sm text-gray-600 mt-1">{item.label}</div>
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
