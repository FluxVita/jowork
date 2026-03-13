import { useRef, useEffect, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualListProps<T> {
  items: T[];
  estimateSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  className?: string;
  /** If true, pins scroll to the bottom (useful for chat). */
  stickToBottom?: boolean;
}

/**
 * Virtualized list component for rendering large lists efficiently.
 * Uses @tanstack/react-virtual for windowed rendering — only DOM nodes
 * for visible items are created, keeping 60fps even with 10k+ items.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  renderItem,
  overscan = 5,
  className = '',
  stickToBottom = false,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  // Scroll to bottom when items change (for chat)
  const prevCount = useRef(items.length);
  const rafRef = useRef<number>();

  if (stickToBottom && items.length > prevCount.current) {
    cancelAnimationFrame(rafRef.current!);
    rafRef.current = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    });
  }
  prevCount.current = items.length;

  // Cancel pending RAF on unmount
  useEffect(() => {
    return () => { cancelAnimationFrame(rafRef.current!); };
  }, []);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={`overflow-y-auto ${className}`}
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
