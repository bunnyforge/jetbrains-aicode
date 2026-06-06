import { useEffect, useRef, useState } from 'react';
import {
  fetchOpenRouterCatalog,
  searchCatalog,
  type OpenRouterModel,
} from '../services/openRouterCatalog';

const DEBOUNCE_MS = 150;

export interface UseModelSearchResult {
  results: ReadonlyArray<OpenRouterModel>;
  loading: boolean;
  /** True when the catalog could not be loaded and there are no matches. */
  unavailable: boolean;
}

/**
 * Debounced live search across the OpenRouter model catalog. Powers the
 * real-time suggestion list rendered under the custom model id input.
 *
 * - Reuses the catalog cache populated by `fetchOpenRouterCatalog` (24h TTL
 *   in localStorage + in-memory in the webview), so once the catalog has
 *   been fetched this hook does no network work.
 * - `query` is debounced at 150ms — shorter than the 400ms capability
 *   lookup so suggestions feel more responsive.
 * - Returns a fresh result list per query; safe to call with `null` (which
 *   clears the list).
 */
export function useModelSearch(
  query: string | null | undefined,
  limit: number = 8
): UseModelSearchResult {
  const [results, setResults] = useState<ReadonlyArray<OpenRouterModel>>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const tokenRef = useRef(0);

  useEffect(() => {
    const trimmed = (query ?? '').trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setUnavailable(false);
      return;
    }
    const myToken = ++tokenRef.current;
    setLoading(true);
    setUnavailable(false);
    const timer = window.setTimeout(() => {
      fetchOpenRouterCatalog()
        .then((catalog) => {
          if (myToken !== tokenRef.current) return;
          const matches = searchCatalog(catalog, trimmed, { limit });
          setResults(matches);
          setLoading(false);
        })
        .catch((err) => {
          if (myToken !== tokenRef.current) return;
          console.warn('[useModelSearch] catalog fetch failed:', err);
          setResults([]);
          setUnavailable(true);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, limit]);

  return { results, loading, unavailable };
}
