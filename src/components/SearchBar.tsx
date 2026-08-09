import React from 'react';
import { Search, X, Filter } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  hasActiveSearch?: boolean;
}

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
  hasActiveSearch = false,
}: SearchBarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="relative flex items-center flex-1 min-w-[180px]">
        <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        <input aria-label="Value"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-base ps-9 pe-9 h-9 text-[12.5px] font-medium [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:appearance-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {hasActiveSearch && (
        <span className="pill pill-brand animate-fade-in">
          <Filter className="w-3 h-3" />
          <span>Search active · filters bypassed</span>
          <button
            onClick={() => onChange('')}
            className="ms-0.5 rounded hover:bg-indigo-100 p-0.5 transition-colors"
            aria-label="Clear active search"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      )}
    </div>
  );
}
