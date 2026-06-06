import { useEffect, useRef, useState } from 'react';
import { lookupModelCapabilities, type ModelCapabilities } from '../services/openRouterCatalog';
import { defaultCapabilitiesFor, inferCapabilityProfile } from '../services/openRouterCatalog';

const DEBOUNCE_MS = 250;

export type ModelCapabilityMap = Map<string, ModelCapabilities | null>;

/**
 * Batch lookup of OpenRouter capabilities for a list of model ids.
 *
 * For each id, the returned map contains either:
 *  - the catalog-derived `ModelCapabilities`,
 *  - `null` (catalog miss — caller can fall back to `defaultCapabilitiesFor`),
 *  - or `undefined` (lookup still in flight).
 *
 * The hook debounces as a batch (not per id) to avoid hammering the catalog
 * cache when the user opens the model picker. Built-in Claude models and
 * custom model ids share the same code path — the catalog returns
 * `null` for misses and the caller decides how to fill defaults.
 */
export function useModelCapabilitiesMap(
  modelIds: ReadonlyArray<string>
): { map: ModelCapabilityMap; loading: boolean } {
  const [map, setMap] = useState<ModelCapabilityMap>(() => new Map());
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(0);

  // Stable signature — re-runs only when the model list itself changes.
  const signature = modelIds.join('\u0001');

  useEffect(() => {
    const ids = modelIds
      .map((id) => (id ?? '').trim())
      .filter((id) => id.length > 0);

    if (ids.length === 0) {
      setMap(new Map());
      setLoading(false);
      return;
    }

    const myToken = ++tokenRef.current;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      const next: ModelCapabilityMap = new Map();
      // Pre-fill with `null` so the UI can show "not in catalog" state
      // immediately while lookups are still in flight.
      for (const id of ids) {
        next.set(id, null);
      }

      await Promise.all(
        ids.map(async (id) => {
          try {
            const caps = await lookupModelCapabilities(id);
            if (myToken !== tokenRef.current) return;
            next.set(
              id,
              caps ?? defaultCapabilitiesFor(id, inferCapabilityProfile(id))
            );
          } catch {
            if (myToken !== tokenRef.current) return;
            next.set(id, defaultCapabilitiesFor(id, inferCapabilityProfile(id)));
          }
        })
      );

      if (myToken !== tokenRef.current) return;
      setMap(next);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { map, loading };
}
