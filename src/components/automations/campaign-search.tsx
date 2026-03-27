'use client';

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { Search, X, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

/** A single selected campaign entry (id + display name). */
interface SelectedCampaign {
  id: string;
  name: string;
}

interface CampaignSearchProps {
  /** Comma-separated campaign IDs (backward-compatible with single ID). */
  value: string;
  /** Comma-separated campaign display names. */
  displayName: string;
  /** Called with comma-separated IDs and names when selection changes. */
  onChange: (id: string, name: string) => void;
  placeholder?: string;
}

/**
 * Multi-select campaign search component.
 * Shows selected campaigns as chips and allows adding/removing via a search dropdown.
 */
export function CampaignSearch({ value, displayName, onChange, placeholder }: CampaignSearchProps) {
  const t = useTranslations('automations');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /** Parse comma-separated values into structured array. */
  const selected: SelectedCampaign[] = useMemo(() => {
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

  const searchCampaigns = useCallback(async (q: string) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/automations/search?type=campaigns&q=${encodeURIComponent(q)}`);
      const data = await res.json();

      setResults(data.data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCampaigns(val), 300);
  };

  const handleFocus = () => {
    setOpen(true);
    if (results.length === 0) searchCampaigns(query);
  };

  /** Toggle a campaign in the selection. */
  const toggleCampaign = (campaign: Campaign) => {
    let next: SelectedCampaign[];

    if (selectedIds.has(campaign.id)) {
      next = selected.filter((s) => s.id !== campaign.id);
    } else {
      next = [...selected, { id: campaign.id, name: campaign.name }];
    }

    onChange(next.map((s) => s.id).join(','), next.map((s) => s.name).join(','));
    // Keep dropdown open for multi-select
    setOpen(true);
  };

  /** Remove a single chip. */
  const removeCampaign = (id: string) => {
    const next = selected.filter((s) => s.id !== id);

    onChange(next.map((s) => s.id).join(','), next.map((s) => s.name).join(','));
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Selected campaign chips */}
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
            >
              <span className="max-w-[180px] truncate">{s.name}</span>
              <button
                type="button"
                onClick={() => removeCampaign(s.id)}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-blue-200 dark:hover:bg-blue-800"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={
            selected.length > 0 ? t('addMoreCampaigns') : placeholder || t('searchCampaigns')
          }
          className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] pr-8 pl-9 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {selected.length > 0 && (
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

      {/* Dropdown results */}
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
              {t('noCampaignsFound')}
            </div>
          ) : (
            results.map((c) => {
              const isSelected = selectedIds.has(c.id);

              return (
                <Button
                  key={c.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleCampaign(c)}
                  className={`h-auto w-full justify-between border-b border-[var(--color-border)] px-4 py-2.5 last:border-0 ${
                    isSelected ? 'bg-blue-500/10' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm text-[var(--color-foreground)]">{c.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                      {c.objective} · {c.status}
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
