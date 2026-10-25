import { useEffect, useRef, useState } from 'react';
import AdminIcon from './AdminIcon';

export interface MultiSelectOption {
  id: string;
  label: string;
  sub?: string;
  badge?: string;
}

interface MultiSelectProps {
  label?: string;
  required?: boolean;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
  showSelectAll?: boolean;
  allOptionLabel?: string;
}

export default function MultiSelect({
  label,
  required = false,
  options = [],
  selected = [],
  onChange,
  placeholder = 'Select options...',
  searchPlaceholder = 'Search & select...',
  disabled = false,
  error,
  className = '',
  showSelectAll = true,
  allOptionLabel,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const filteredOptions = options.filter(opt => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return opt.label.toLowerCase().includes(q) || (opt.sub && opt.sub.toLowerCase().includes(q));
  });

  const allSelected = options.length > 0 && options.every(opt => selected.includes(opt.id));
  const isAllOptionActive = Boolean(allOptionLabel && allSelected);

  function toggleOption(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter(item => item !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  function handleSelectAll() {
    const allIds = options.map(o => o.id);
    onChange(allIds);
  }

  function handleDeselectAll() {
    onChange([]);
  }

  function handleToggleAllOption() {
    if (allSelected) {
      handleDeselectAll();
    } else {
      handleSelectAll();
    }
  }

  function removeChip(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    onChange(selected.filter(item => item !== id));
  }

  const selectedItems = options.filter(opt => selected.includes(opt.id));

  return (
    <div className={`relative min-w-0 ${className}`} ref={containerRef}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-600">
          <span>
            {label} {required && <span className="text-rose-500">*</span>}
          </span>
          {showSelectAll && options.length > 1 && (
            <div className="flex items-center gap-2 text-[11px] font-semibold lowercase">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-orange-600 hover:underline"
              >
                Select all
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="text-slate-500 hover:underline"
              >
                Deselect all
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main trigger container */}
      <div
        onClick={() => !disabled && setOpen(!open)}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!disabled) setOpen(!open);
          }
        }}
        className={`flex min-h-[44px] w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-sm transition outline-none ${
          disabled ? 'cursor-not-allowed bg-slate-50 opacity-60' : 'hover:border-slate-400'
        } ${
          error
            ? 'border-rose-400 focus:ring-2 focus:ring-rose-100'
            : open
            ? 'border-orange-500 ring-2 ring-orange-100'
            : 'border-slate-300'
        }`}
      >
        {isAllOptionActive ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">
            {allOptionLabel} ({options.length})
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                handleDeselectAll();
              }}
              className="ml-1 text-orange-600 hover:text-orange-950"
            >
              ×
            </button>
          </span>
        ) : selectedItems.length > 0 ? (
          selectedItems.slice(0, 6).map(item => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800"
            >
              <span className="max-w-[120px] truncate">{item.label}</span>
              <button
                type="button"
                onClick={e => removeChip(e, item.id)}
                className="ml-0.5 text-slate-400 hover:text-slate-700 font-bold"
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-400">{placeholder}</span>
        )}

        {selectedItems.length > 6 && !isAllOptionActive && (
          <span className="rounded-lg bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700">
            +{selectedItems.length - 6} more
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 text-slate-400">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                handleDeselectAll();
              }}
              className="p-1 hover:text-slate-600"
              title="Clear all"
            >
              <AdminIcon name="close" className="h-3.5 w-3.5" />
            </button>
          )}
          <AdminIcon
            name="chevronDown"
            className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {error && <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p>}

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          {/* Search bar inside dropdown */}
          <div className="border-b border-slate-100 p-2.5">
            <div className="relative flex items-center">
              <span className="absolute left-3 text-slate-400">
                <AdminIcon name="search" className="h-4 w-4" />
              </span>
              <input
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs outline-none focus:border-orange-500 focus:bg-white"
                onClick={e => e.stopPropagation()}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Quick links & summary */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
            <span>
              {selected.length} of {options.length} selected
            </span>
            <div className="flex items-center gap-2 font-bold">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-orange-600 hover:underline"
              >
                Select all
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="text-slate-500 hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-50 p-1">
            {allOptionLabel && (
              <label
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-bold text-orange-900 transition hover:bg-orange-50/70"
                onClick={e => {
                  e.preventDefault();
                  handleToggleAllOption();
                }}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={isAllOptionActive}
                    onChange={() => {}}
                    className="h-4 w-4 rounded accent-orange-600"
                  />
                  <span>{allOptionLabel}</span>
                </div>
                <span className="rounded bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                  {options.length} total
                </span>
              </label>
            )}

            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                No matching options found
              </div>
            ) : (
              filteredOptions.map(opt => {
                const isChecked = selected.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs transition ${
                      isChecked ? 'bg-orange-50/60 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                    onClick={e => {
                      e.preventDefault();
                      toggleOption(opt.id);
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="h-4 w-4 shrink-0 rounded accent-orange-600"
                      />
                      <div className="truncate">
                        <div className="truncate font-medium">{opt.label}</div>
                        {opt.sub && <div className="truncate text-[11px] text-slate-400">{opt.sub}</div>}
                      </div>
                    </div>
                    {opt.badge && (
                      <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                        {opt.badge}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
