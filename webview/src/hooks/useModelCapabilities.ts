import { useEffect, useRef, useState } from 'react';
import { lookupModelCapabilities, type ModelCapabilities } from '../services/openRouterCatalog';

const DEBOUNCE_MS = 400;

export interface UseModelCapabilitiesResult {
  capabilities: ModelCapabilities | null;
  loading: boolean;
  /** True if the most recent lookup completed without finding the model. */
  notFound: boolean;
}

/**
 * Debounced lookup of OpenRouter capabilities for a single model id.
 * Returns `null` capabilities while loading or when the model is not in the
 * catalog. Re-fetches automatically when `modelId` changes.
 */
export function useModelCapabilities(modelId: string | null | undefined): UseModelCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<ModelCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const tokenRef = useRef(0);

  useEffect(() => {
    const trimmed = (modelId ?? '').trim();
    console.debug('[useModelCapabilities] effect: modelId =', JSON.stringify(modelId), '→ trimmed =', JSON.stringify(trimmed));
    if (!trimmed) {
      console.debug('[useModelCapabilities] empty modelId → reset state');
      setCapabilities(null);
      setLoading(false);
      setNotFound(false);
      return;
    }
    const myToken = ++tokenRef.current;
    setLoading(true);
    setNotFound(false);
    console.debug(`[useModelCapabilities] lookup scheduled (token=${myToken}, debounce=${DEBOUNCE_MS}ms)`);
    const timer = window.setTimeout(() => {
      console.debug(`[useModelCapabilities] debounce fired (token=${myToken}) — calling lookupModelCapabilities("${trimmed}")`);
      lookupModelCapabilities(trimmed).then(caps => {
        if (myToken !== tokenRef.current) {
          console.debug(`[useModelCapabilities] token mismatch (got=${myToken} current=${tokenRef.current}) → ignore stale result`);
          return;
        }
        if (caps) {
          console.debug('[useModelCapabilities] resolved: capabilities =', {
            contextWindow: caps.contextWindow,
            reasoningLevels: caps.reasoningLevels,
            supportsImageInput: caps.supportsImageInput,
            supportsReasoning: caps.supportsReasoning,
            supportedParameters: caps.supportedParameters,
            source: caps.source,
          });
        } else {
          console.debug('[useModelCapabilities] resolved: null (no match)');
        }
        setCapabilities(caps);
        setNotFound(caps === null);
        setLoading(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      console.debug(`[useModelCapabilities] cleanup (token=${myToken})`);
      window.clearTimeout(timer);
    };
  }, [modelId]);

  return { capabilities, loading, notFound };
}
