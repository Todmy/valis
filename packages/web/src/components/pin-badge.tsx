/**
 * T033: Pin badge component — pinned indicator.
 */

'use client';

export function PinBadge({ pinned }: { pinned?: boolean }) {
  if (!pinned) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-950 text-blue-300"
      title="Pinned — exempt from confidence decay"
    >
      pinned
    </span>
  );
}
