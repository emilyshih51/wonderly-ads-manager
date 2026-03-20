'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { Search, X, Loader2, Check } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

interface CampaignSearchProps {
  value: string;
  displayName: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
}

export function CampaignSearch({ value, displayName, onChange, placeholder }: CampaignSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={open ? query : displayName || query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder || 'Search campaigns...'}
          className="h-10 w-full rounded-lg border border-gray-200 pr-8 pl-9 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {value && (
          <button
            onClick={() => {
              onChange('', '');
              setQuery('');
            }}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">No campaigns found</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  onChange(c.id, c.name);
                  setQuery(c.name);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between border-b border-gray-50 px-4 py-2.5 text-left last:border-0 hover:bg-gray-50 ${
                  c.id === value ? 'bg-blue-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">{c.name}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {c.objective} · {c.status}
                  </p>
                </div>
                {c.id === value && <Check className="ml-2 h-4 w-4 flex-shrink-0 text-blue-600" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
