import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lookupModelCapabilities, defaultCapabilitiesFor, type ModelCapabilities } from '../../services/openRouterCatalog';
import { ModelCapabilitiesTags } from './ModelCapabilitiesTags';

const HINT_STYLE: React.CSSProperties = {
  marginTop: '4px',
  fontSize: '11px',
  color: 'var(--text-tertiary)',
};

const NOT_FOUND_STYLE: React.CSSProperties = {
  ...HINT_STYLE,
  color: 'var(--text-tertiary)',
};

const DEBOUNCE_MS = 350;

/**
 * Per-field wrapper used by the provider dialog's sonnet/opus/haiku inputs.
 * Watches the current value, debounces a single OpenRouter lookup, and
 * renders a row of capability pills (context / tools / image / file) when
 * the model id is recognized — or a soft "not in OpenRouter catalog" hint
 * otherwise. Defaults are filled in via `defaultCapabilitiesFor` even on
 * miss, so the user always sees a usable tag row.
 */
export function ProviderModelFieldCapability({
  modelId,
  onCapabilitiesResolved,
}: {
  modelId: string;
  /** Optional callback fired with the resolved (catalog or default) capabilities. */
  onCapabilitiesResolved?: (caps: ModelCapabilities | null) => void;
}) {
  const { t } = useTranslation();
  const [caps, setCaps] = useState<ModelCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const trimmed = (modelId ?? '').trim();
    if (!trimmed) {
      setCaps(null);
      setNotFound(false);
      setLoading(false);
      onCapabilitiesResolved?.(null);
      return;
    }
    setLoading(true);
    setNotFound(false);
    const timer = window.setTimeout(async () => {
      try {
        const resolved = await lookupModelCapabilities(trimmed);
        if (resolved) {
          setCaps(resolved);
          setNotFound(false);
          onCapabilitiesResolved?.(resolved);
        } else {
          // Catalog miss — apply provider-mapping defaults (Claude family)
          const defaults = defaultCapabilitiesFor(trimmed, 'claude-mapping');
          setCaps(defaults);
          setNotFound(true);
          onCapabilitiesResolved?.(defaults);
        }
      } catch {
        setNotFound(true);
        onCapabilitiesResolved?.(null);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [modelId, onCapabilitiesResolved]);

  if (!modelId.trim()) return null;

  return (
    <div style={{ marginTop: '4px' }}>
      {loading && !caps ? (
        <span style={HINT_STYLE}>
          <span className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '4px' }} />
          {t('settings.pluginModels.lookingUp', { defaultValue: 'Looking up…' })}
        </span>
      ) : caps ? (
        <>
          <ModelCapabilitiesTags
            capabilities={caps}
            showImage
            showTools
            showFile
          />
          {notFound && (
            <div style={NOT_FOUND_STYLE}>
              {t('settings.pluginModels.openRouterNotFound', {
                defaultValue: 'Not in OpenRouter catalog — showing Claude defaults.',
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default ProviderModelFieldCapability;
