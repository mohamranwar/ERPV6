import React, { useRef, useState, useEffect } from 'react';

interface ScrollableTableProps {
  children: React.ReactNode;
  className?: string;
}

export default function ScrollableTable({ children, className = '' }: ScrollableTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  const checkOverflow = () => {
    const el = containerRef.current;
    if (el) {
      const isOverflowing = el.scrollWidth > el.clientWidth;
      setShowScrollHint(isOverflowing);
    }
  };

  useEffect(() => {
    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    
    // Check overflow periodically or when child sizes might change
    const observer = new ResizeObserver(checkOverflow);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', checkOverflow);
      observer.disconnect();
    };
  }, [children]);

  return (
    <div className="relative w-full">
      <div 
        ref={containerRef}
        className={`scroll-x-touch w-full overflow-x-auto border border-slate-300 rounded-md bg-white shadow-2xs ${className}`}
        onScroll={checkOverflow}
      >
        {children}
      </div>
      
      {showScrollHint && (
        <div className="flex justify-center mt-1.5 pointer-events-none animate-pulse">
          <span className="text-[11px] text-slate-400 font-medium">
            &larr; Swipe to see more columns &rarr;
          </span>
        </div>
      )}
    </div>
  );
}
