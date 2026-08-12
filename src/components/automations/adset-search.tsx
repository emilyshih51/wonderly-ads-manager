'use client';

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { Search, X, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

interface AdSet {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign_name?: string;
}

/** A single selected ad set entry (id + display name). */
interface SelectedAdSet {
  id: string;
  name: string;
}

interface AdSetSearchProps {
  /** Selected ad set ID. In `multiple` mode this is a comma-separated list. */
  value: string;
  /** Selected ad set display name. In `multiple` mode this is a comma-separated list. */
  displayName: string;
  campaignId?: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
  /**
   * When true, allow selecting several ad sets. Selections render as chips and
   * the value/displayName become comma-separated lists. Defaults to false
   * (single-select) so existing single-target usages are unchanged.
   */
  multiple?: boolean;
}

export function AdSetSearch({
  value,
  displayName,
  campaignId,
  onChange,
  placeholder,
  multiple = false,
}: AdSetSearchProps) {
  const t = useTranslations('automations');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdSet[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /** Parse comma-separated values into a structured array (multi-select mode). */
  const selected: SelectedAdSet[] = useMemo(() => {
    if (!value) return [];

    const ids = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const names = displayName.split(',').map((s) => s.trim());

    return ids.map((id, i) => ({ id, name: names[i] || id }));
  }, [value, displayName]);

  /** Set of selected IDs for quick lookup. */
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);

    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const searchAdSets = useCallback(
    async (q: string) => {
      setLoading(true);

      try {
        let url = `/api/automations/search?type=adsets&q=${encodeURIComponent(q)}`;

        if (campaignId) url += `&campaign_id=${campaignId}`;
        const res = await fetch(url);
        const data = await res.json();

        setResults(data.data || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [campaignId]
  );

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAdSets(val), 300);
  };

  const handleFocus = () => {
    setOpen(true);
    if (results.length === 0) searchAdSets(query);
  };

  /** Select a single ad set (single-select mode). */
  const selectSingle = (a: AdSet) => {
    onChange(a.id, a.name);
    setQuery(a.name);
    setOpen(false);
  };

  /** Toggle an ad set in the selection (multi-select mode). */
  const toggleAdSet = (a: AdSet) => {
    let next: SelectedAdSet[];

    if (selectedIds.has(a.id)) {
      next = selected.filter((s) => s.id !== a.id);
    } else {
      next = [...selected, { id: a.id, name: a.name }];
    }

    onChange(next.map((s) => s.id).join(','), next.map((s) => s.name).join(','));
    // Keep dropdown open for multi-select and clear the query for the next search.
    setQuery('');
    setOpen(true);
  };

  /** Remove a single chip (multi-select mode). */
  const removeAdSet = (id: string) => {
    const next = selected.filter((s) => s.id !== id);

    onChange(next.map((s) => s.id).join(','), next.map((s) => s.name).join(','));
  };

  const hasSelection = multiple ? selected.length > 0 : !!value;

  return (
    <div ref={containerRef} className="relative">
      {/* Selected ad set chips (multi-select mode only) */}
      {multiple && selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
            >
              <span className="max-w-[180px] truncate">{s.name}</span>
              <button
                type="button"
                onClick={() => removeAdSet(s.id)}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-blue-200 dark:hover:bg-blue-800"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        <input
          type="text"
          value={multiple ? query : open ? query : displayName || query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={
            multiple && selected.length > 0 ? t('addMoreAdSets') : placeholder || t('searchAdSets')
          }
          className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] pr-8 pl-9 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {hasSelection && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              onChange('', '');
              setQuery('');
            }}
            className="absolute top-1/2 right-2.5 h-auto w-auto -translate-y-1/2 p-0.5"
          >
            <X className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          </Button>
        )}
      </div>
      {open && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg"
        >
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
              {t('noAdSetsFound')}
            </div>
          ) : (
            results.map((a) => {
              const isSelected = multiple ? selectedIds.has(a.id) : a.id === value;

              return (
                <Button
                  key={a.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => (multiple ? toggleAdSet(a) : selectSingle(a))}
                  className={`h-auto w-full justify-between border-b border-[var(--color-border)] px-4 py-2.5 last:border-0 ${
                    isSelected ? 'bg-blue-500/10' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm text-[var(--color-foreground)]">{a.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                      {a.status}
                      {a.campaign_name ? ` · ${a.campaign_name}` : ''}
                    </p>
                  </div>
                  {isSelected && <Check className="ml-2 h-4 w-4 flex-shrink-0 text-blue-600" />}
                </Button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
