import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { SortConfig } from '../hooks/useTableSort';

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  sortConfig: SortConfig;
  onSort: (key: string) => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
  children?: React.ReactNode;
}

export default function SortableHeader({
  label,
  sortKey,
  sortConfig,
  onSort,
  align = 'center',
  className = '',
  children,
}: SortableHeaderProps) {
  const isActive = sortConfig.key === sortKey && sortConfig.direction !== null;

  const alignClass = align === 'right' ? 'justify-end text-right' : align === 'left' ? 'justify-start text-left' : 'justify-center text-center';
  const textAlignStyle = align === 'right' ? 'text-right' : align === 'left' ? 'text-left' : 'text-center';

  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none hover:bg-brand-900/90 transition-colors group text-center ${textAlignStyle} ${className}`}
      title={`Sort by ${label}`}
    >
      <div className={`flex items-center gap-1.5 ${alignClass}`}>
        <span className="truncate font-bold tracking-wider text-[0.64rem]">{children || label}</span>
        <span className="shrink-0 transition-opacity">
          {isActive ? (
            sortConfig.direction === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5 text-amber-300 font-bold" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-amber-300 font-bold" />
            )
          ) : (
            <ArrowUpDown className="w-3 h-3 text-brand-300/60 group-hover:text-white transition-opacity" />
          )}
        </span>
      </div>
    </th>
  );
}
