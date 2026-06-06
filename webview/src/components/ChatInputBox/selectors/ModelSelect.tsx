import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_MODELS, normalizeClaudeModelId } from '../types';
import type { ModelInfo } from '../types';
import {
  MODEL_ID_TO_MAPPING_KEY,
  readClaudeModelMapping,
  resolveMappedModelName,
} from '../../../utils/claudeModelMapping';
import { ProviderModelIcon } from '../../shared/ProviderModelIcon';
import { ModelCapabilitiesTags } from '../../settings/ModelCapabilitiesTags';
import { useModelCapabilitiesMap } from '../../../hooks/useModelCapabilitiesMap';

const RELATIVE_INLINE_BLOCK_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };
const CHEVRON_ICON_STYLE: React.CSSProperties = { fontSize: '10px', marginLeft: '2px' };
const DROPDOWN_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: '4px',
  zIndex: 10000,
};
const MODEL_OPTION_INFO_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 };
const MODEL_ID_STYLE: React.CSSProperties = {
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: '13px',
  fontWeight: 500,
  wordBreak: 'break-all',
};

interface ModelSelectProps {
  value: string;
  onChange: (modelId: string) => void;
  models?: ModelInfo[];
  currentProvider?: string;
  onAddModel?: () => void;
}

const DEFAULT_MODEL_MAP: Record<string, ModelInfo> = AVAILABLE_MODELS.reduce(
  (acc, model) => {
    acc[model.id] = model;
    return acc;
  },
  {} as Record<string, ModelInfo>
);

const MODEL_LABEL_KEYS: Record<string, string> = {
  'claude-sonnet-4-6': 'models.claude.sonnet46.label',
  'claude-opus-4-8': 'models.claude.opus48.label',
  'claude-opus-4-7': 'models.claude.opus46.label',
  'claude-opus-4-6': 'models.claude.opus46_1m.label',
  'claude-haiku-4-5': 'models.claude.haiku45.label',
};

/**
 * Resolve the display model name for icon matching.
 * For mapped Claude models, returns the mapped name; otherwise the original ID.
 */
const resolveModelIdForIcon = (
  modelId: string,
  modelMapping: Record<string, string | undefined>
): string => {
  if (!(modelId in MODEL_ID_TO_MAPPING_KEY)) {
    return modelId;
  }
  return resolveMappedModelName(modelId, modelMapping) ?? modelId;
};

/**
 * ModelSelect - Model selector component
 * Supports switching between Sonnet 4.5, Opus 4.5, and other models, including Codex models
 */
export const ModelSelect = ({ value, onChange, models = AVAILABLE_MODELS, currentProvider = 'claude', onAddModel }: ModelSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const normalizedValue = currentProvider === 'claude' ? normalizeClaudeModelId(value) : value;
  const currentModel = models.find(m => m.id === normalizedValue) || models[0];
  const modelMapping = readClaudeModelMapping();

  // Resolve the *effective* model id (post-mapping) for the catalog lookup,
  // so the displayed tags match the model actually sent to the backend.
  const effectiveModelIds = useMemo(
    () =>
      models.map((m) =>
        resolveModelIdForIcon(m.id, modelMapping) ?? m.id
      ),
    [models, modelMapping]
  );

  // Batch OpenRouter metadata lookup — only runs while the dropdown is open
  // to avoid the per-keystroke work for the static header chip.
  const { map: capabilitiesMap } = useModelCapabilitiesMap(
    isOpen ? effectiveModelIds : []
  );

  const isSelectedModel = (modelId: string): boolean => {
    if (currentProvider !== 'claude') {
      return modelId === value;
    }
    return normalizeClaudeModelId(modelId) === normalizedValue;
  };

  const getModelLabel = (model: ModelInfo): string => {
    if (model.id in MODEL_ID_TO_MAPPING_KEY) {
      const mappedName = resolveMappedModelName(model.id, modelMapping);
      if (mappedName) {
        return mappedName;
      }
    }

    const defaultModel = DEFAULT_MODEL_MAP[model.id];
    const labelKey = MODEL_LABEL_KEYS[model.id];
    const hasCustomLabel = defaultModel && model.label && model.label !== defaultModel.label;

    if (hasCustomLabel) {
      return model.label ?? '';
    }

    if (labelKey) {
      return t(labelKey);
    }

    return model.label ?? '';
  };

  /**
   * Toggle dropdown
   */
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  }, [isOpen]);

  /**
   * Select model
   */
  const handleSelect = useCallback((modelId: string) => {
    onChange(modelId);
    setIsOpen(false);
  }, [onChange]);

  /**
   * Close on outside click
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    // Delay adding event listener to prevent immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div style={RELATIVE_INLINE_BLOCK_STYLE}>
      <button
        ref={buttonRef}
        className="selector-button"
        onClick={handleToggle}
        title={t('chat.currentModel', { model: getModelLabel(currentModel) })}
      >
        <ProviderModelIcon
          providerId={currentProvider}
          modelId={resolveModelIdForIcon(currentModel.id, modelMapping)}
          size={12}
          colored
        />
        <span className="selector-button-text">{getModelLabel(currentModel)}</span>
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={CHEVRON_ICON_STYLE} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="selector-dropdown"
          style={DROPDOWN_STYLE}
        >
          {models.map((model) => {
            const effectiveId = resolveModelIdForIcon(model.id, modelMapping) ?? model.id;
            const caps = capabilitiesMap.get(effectiveId);
            return (
              <div
                key={model.id}
                className={`selector-option ${isSelectedModel(model.id) ? 'selected' : ''}`}
                onClick={() => handleSelect(model.id)}
              >
                <ProviderModelIcon
                  providerId={currentProvider}
                  modelId={effectiveId}
                  size={16}
                  colored
                />
                <div style={MODEL_OPTION_INFO_STYLE}>
                  <span style={MODEL_ID_STYLE}>{effectiveId}</span>
                  <ModelCapabilitiesTags
                    capabilities={caps ?? null}
                    showImage
                    showTools
                    compact
                  />
                </div>
                {isSelectedModel(model.id) && (
                  <span className="codicon codicon-check check-mark" />
                )}
              </div>
            );
          })}
          {onAddModel && (
            <>
              <div className="selector-divider" />
              <div
                className="selector-option selector-option-add"
                onClick={() => { onAddModel(); setIsOpen(false); }}
              >
                <span className="codicon codicon-add selector-add-icon" />
                <span>{t('models.addModel')}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelSelect;
