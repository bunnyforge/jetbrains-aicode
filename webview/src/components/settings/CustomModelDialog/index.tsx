import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
// Model ID format is intentionally not restricted — see isValidModelId() JSDoc for rationale
import { useModelCapabilities } from '../../../hooks/useModelCapabilities';
import { useModelSearch } from '../../../hooks/useModelSearch';
import type { ModelCapabilities, OpenRouterModel } from '../../../services/openRouterCatalog';
import { ModelSuggestionDropdown } from './ModelSuggestionDropdown';
import { ModelCapabilitiesTags } from '../ModelCapabilitiesTags';
import styles from './style.module.less';

const DIALOG_STYLE: React.CSSProperties = { maxWidth: '560px' };
const FLEX_1_STYLE: React.CSSProperties = { flex: 1 };
const DESC_INPUT_STYLE: React.CSSProperties = { width: '100%', marginBottom: '8px' };
const ADD_ICON_STYLE: React.CSSProperties = { marginRight: '4px' };
const INPUT_GROUP_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px' };
const SPINNER_STYLE: React.CSSProperties = { fontSize: '12px', color: 'var(--text-tertiary)' };
const CAPS_PANEL_STYLE: React.CSSProperties = {
  marginTop: '8px',
  padding: '8px 10px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-secondary)',
  borderRadius: '4px',
  fontSize: '12px',
};

export interface CustomModel {
  id: string;
  label?: string;
  description?: string;
  capabilities?: ModelCapabilities;
}

interface CustomModelDialogProps {
  isOpen: boolean;
  models: CustomModel[];
  onModelsChange: (models: CustomModel[]) => void;
  onClose: () => void;
  /** If provided, opens in add-model mode directly */
  initialAddMode?: boolean;
}

/**
 * Sanitize user input by stripping control characters and collapsing whitespace.
 * React JSX auto-escapes HTML entities, but this provides defense-in-depth
 * for values persisted to localStorage which may be consumed by non-React code.
 */
function sanitizeInput(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ');
}

function CapabilityBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        padding: '2px 6px',
        borderRadius: '10px',
        fontSize: '11px',
        background: present ? 'var(--badge-info-bg, rgba(56, 139, 253, 0.15))' : 'var(--bg-tertiary, rgba(127,127,127,0.1))',
        color: present ? 'var(--badge-info-fg, #389bfd)' : 'var(--text-tertiary)',
        opacity: present ? 1 : 0.55,
      }}
    >
      <span className={`codicon ${present ? 'codicon-check' : 'codicon-circle-outline'}`} style={{ fontSize: '10px' }} />
      {label}
    </span>
  );
}

function buildCapabilities(
  lookup: ModelCapabilities | null,
  contextWindowOverride: number | undefined
): ModelCapabilities | undefined {
  if (lookup) {
    return {
      ...lookup,
      contextWindow: contextWindowOverride ?? lookup.contextWindow,
    };
  }
  if (contextWindowOverride) {
    return {
      contextWindow: contextWindowOverride,
      supportedParameters: [],
      inputModalities: [],
      outputModalities: [],
      reasoningLevels: [],
      supportsImageInput: false,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsToolUse: false,
      supportsStructuredOutput: false,
      supportsReasoning: false,
      source: 'openrouter',
      fetchedAt: Date.now(),
    };
  }
  return undefined;
}

/**
 * Custom Model Management Dialog
 * Full CRUD for plugin-level custom models in a modal dialog.
 * When the user types a model id, the dialog debounce-looks it up on
 * OpenRouter and auto-fills the context window + capability badges.
 */
export function CustomModelDialog({
  isOpen,
  models,
  onModelsChange,
  onClose,
  initialAddMode = false,
}: CustomModelDialogProps) {
  const { t } = useTranslation();

  // Form state
  const [isAdding, setIsAdding] = useState(false);
  const [editingModel, setEditingModel] = useState<CustomModel | null>(null);
  const [newModelId, setNewModelId] = useState('');
  const [newModelLabel, setNewModelLabel] = useState('');
  const [newModelDesc, setNewModelDesc] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [contextWindowOverride, setContextWindowOverride] = useState<string>('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [suppressSuggestionOpen, setSuppressSuggestionOpen] = useState(false);
  const modelIdInputRef = useRef<HTMLInputElement>(null);
  const suggestionWrapperRef = useRef<HTMLDivElement>(null);

  // Debounced OpenRouter lookup for the id currently in the input.
  const { capabilities, loading: capsLoading, notFound } = useModelCapabilities(
    isAdding ? newModelId : null
  );

  // Live suggestion list sourced from the same OpenRouter catalog. Only
  // runs while the add/edit form is mounted; the hook itself debounces
  // internally and short-circuits on empty input.
  const {
    results: suggestionResults,
    loading: suggestionsLoading,
    unavailable: suggestionsUnavailable,
  } = useModelSearch(isAdding ? newModelId : null, 8);

  const activeSuggestion: OpenRouterModel | null =
    suggestionResults[activeSuggestionIndex] ?? null;

  const openSuggestions = useCallback(() => {
    if (suppressSuggestionOpen) {
      setSuppressSuggestionOpen(false);
      return;
    }
    setSuggestionsOpen(true);
  }, [suppressSuggestionOpen]);

  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
  }, []);

  const handleSelectSuggestion = useCallback((model: OpenRouterModel) => {
    setNewModelId(model.id);
    if (validationError) setValidationError(null);
    // Hide the dropdown after selection; the existing capability lookup
    // will pick up the new id and auto-fill the context window.
    closeSuggestions();
    setSuppressSuggestionOpen(true);
    modelIdInputRef.current?.focus();
  }, [validationError, closeSuggestions]);

  const handleModelIdKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestionsOpen || suggestionResults.length === 0) {
      if (e.key === 'ArrowDown' && suggestionResults.length > 0) {
        e.preventDefault();
        setSuggestionsOpen(true);
        setActiveSuggestionIndex(0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex((idx) => (idx + 1) % suggestionResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex((idx) =>
        idx === 0 ? suggestionResults.length - 1 : idx - 1
      );
    } else if (e.key === 'Enter' && activeSuggestion) {
      e.preventDefault();
      handleSelectSuggestion(activeSuggestion);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSuggestions();
    }
  }, [suggestionsOpen, suggestionResults, activeSuggestion, handleSelectSuggestion, closeSuggestions]);

  // When capabilities arrive and the user hasn't manually edited the context
  // window, auto-fill it. We only auto-fill on lookup success, not on each
  // re-render.
  useEffect(() => {
    if (capabilities && capabilities.contextWindow > 0) {
      console.debug('[CustomModelDialog] auto-filling contextWindowOverride from capabilities:', capabilities.contextWindow);
      setContextWindowOverride(String(capabilities.contextWindow));
    }
  }, [capabilities]);

  // Auto-open add form when initialAddMode is true
  useEffect(() => {
    if (isOpen && initialAddMode) {
      setIsAdding(true);
      setEditingModel(null);
      setNewModelId('');
      setNewModelLabel('');
      setNewModelDesc('');
      setValidationError(null);
      setContextWindowOverride('');
      setSuggestionsOpen(false);
      setActiveSuggestionIndex(0);
    }
  }, [isOpen, initialAddMode]);

  // Reset form state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setIsAdding(false);
      setEditingModel(null);
      setNewModelId('');
      setNewModelLabel('');
      setNewModelDesc('');
      setValidationError(null);
      setContextWindowOverride('');
      setSuggestionsOpen(false);
      setActiveSuggestionIndex(0);
      setSuppressSuggestionOpen(false);
    }
  }, [isOpen]);

  // ESC key handler — closes the dialog, or the suggestion list if it's
  // open and capturing the escape (handled at the input level too, this
  // is the safety net for click-outside + focus-loss cases).
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (suggestionsOpen) {
          e.stopPropagation();
          closeSuggestions();
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, suggestionsOpen, closeSuggestions]);

  // Click-outside handler — closes the suggestion list when the user
  // clicks anywhere outside the input wrapper (e.g. on the dialog body,
  // another input, or the model list).
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (suggestionWrapperRef.current?.contains(target)) return;
      closeSuggestions();
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [suggestionsOpen, closeSuggestions]);

  const validateModelId = useCallback((id: string): string | null => {
    const trimmedId = id.trim();
    if (!trimmedId || trimmedId.length > 256) {
      return t('settings.codexProvider.dialog.modelIdRequired') || 'Model ID is required';
    }
    const isDuplicate = models.some(m =>
      m.id === trimmedId && (!editingModel || m.id !== editingModel.id)
    );
    if (isDuplicate) {
      return t('settings.codexProvider.dialog.modelIdDuplicate') || 'Model ID already exists';
    }
    return null;
  }, [models, editingModel, t]);

  const handleAddModel = useCallback(() => {
    const error = validateModelId(newModelId);
    if (error) {
      setValidationError(error);
      return;
    }
    const trimmedId = sanitizeInput(newModelId).trim();
    const trimmedLabel = sanitizeInput(newModelLabel).trim() || trimmedId;
    const trimmedDesc = sanitizeInput(newModelDesc).trim() || undefined;
    const override = contextWindowOverride.trim()
      ? Number.parseInt(contextWindowOverride, 10)
      : NaN;
    const resolvedContextWindow = Number.isFinite(override) && override > 0 ? override : undefined;
    const newModel: CustomModel = {
      id: trimmedId,
      label: trimmedLabel,
      description: trimmedDesc,
      capabilities: buildCapabilities(capabilities, resolvedContextWindow),
    };
    onModelsChange([...models, newModel]);
    setNewModelId('');
    setNewModelLabel('');
    setNewModelDesc('');
    setContextWindowOverride('');
    setIsAdding(false);
    setValidationError(null);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
  }, [models, newModelId, newModelLabel, newModelDesc, contextWindowOverride, capabilities, onModelsChange, validateModelId]);

  const handleSaveEdit = useCallback(() => {
    if (!editingModel) return;
    const error = validateModelId(newModelId);
    if (error) {
      setValidationError(error);
      return;
    }
    const trimmedId = sanitizeInput(newModelId).trim();
    const trimmedLabel = sanitizeInput(newModelLabel).trim() || trimmedId;
    const trimmedDesc = sanitizeInput(newModelDesc).trim() || undefined;
    const override = contextWindowOverride.trim()
      ? Number.parseInt(contextWindowOverride, 10)
      : NaN;
    const resolvedContextWindow = Number.isFinite(override) && override > 0 ? override : undefined;
    const updatedModels = models.map(m => {
      if (m.id === editingModel.id) {
        return {
          id: trimmedId,
          label: trimmedLabel,
          description: trimmedDesc,
          capabilities: buildCapabilities(capabilities, resolvedContextWindow),
        };
      }
      return m;
    });
    onModelsChange(updatedModels);
    setEditingModel(null);
    setNewModelId('');
    setNewModelLabel('');
    setNewModelDesc('');
    setContextWindowOverride('');
    setIsAdding(false);
    setValidationError(null);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
  }, [models, editingModel, newModelId, newModelLabel, newModelDesc, contextWindowOverride, capabilities, onModelsChange, validateModelId]);

  const handleEditModel = useCallback((model: CustomModel) => {
    setEditingModel(model);
    setNewModelId(model.id);
    setNewModelLabel(model.label ?? '');
    setNewModelDesc(model.description || '');
    setContextWindowOverride(model.capabilities?.contextWindow ? String(model.capabilities.contextWindow) : '');
    setIsAdding(true);
    setValidationError(null);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
  }, []);

  const handleRemoveModel = useCallback((id: string) => {
    onModelsChange(models.filter(m => m.id !== id));
  }, [models, onModelsChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingModel(null);
    setNewModelId('');
    setNewModelLabel('');
    setNewModelDesc('');
    setContextWindowOverride('');
    setIsAdding(false);
    setValidationError(null);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog provider-dialog" style={DIALOG_STYLE}>
        <div className="dialog-header">
          <h3>{t('settings.pluginModels.dialogTitle')}</h3>
          <button className="close-btn" onClick={onClose} title={t('common.close')}>
            <span className="codicon codicon-close" />
          </button>
        </div>

        <div className="dialog-body">
          <p className="dialog-desc">{t('settings.pluginModels.description')}</p>

          {/* Model list */}
          <div className={styles.modelList} role="list" aria-label={t('settings.pluginModels.dialogTitle')}>
            {(!Array.isArray(models) || models.length === 0) && !isAdding ? (
              <div className={styles.emptyState} role="status">
                {t('settings.codexProvider.dialog.noCustomModels')}
              </div>
            ) : (
              models.map((model) => (
                <div key={model.id} className={styles.modelItem} role="listitem">
                  <div className={styles.modelItemContent}>
                    <span className={styles.modelItemId} title={model.id}>{model.id}</span>
                    {model.label !== model.id && (
                      <span className={styles.modelItemLabel} title={model.label}>
                        {model.label}
                      </span>
                    )}
                    {model.capabilities && (
                      <div className={styles.modelItemTags}>
                        <ModelCapabilitiesTags
                          capabilities={model.capabilities}
                          showImage
                          showTools
                          showFile
                          compact
                        />
                      </div>
                    )}
                  </div>
                  <div className={styles.modelItemActions}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => handleEditModel(model)}
                      title={t('common.edit')}
                      aria-label={`${t('common.edit')} ${model.id}`}
                    >
                      <span className="codicon codicon-edit" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtnDanger}
                      onClick={() => handleRemoveModel(model.id)}
                      title={t('common.delete')}
                      aria-label={`${t('common.delete')} ${model.id}`}
                    >
                      <span className="codicon codicon-trash" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add/edit form */}
          {isAdding ? (
            <div className={styles.addEditForm} role="form" aria-label={editingModel ? t('common.edit') : t('common.add')}>
              <div className={styles.formRow}>
                <label htmlFor="model-id-input" className="sr-only">
                  {t('settings.codexProvider.dialog.modelIdPlaceholder')}
                </label>
                <div style={INPUT_GROUP_STYLE}>
                  <div className={styles.suggestionWrapper} ref={suggestionWrapperRef}>
                    <input
                      id="model-id-input"
                      ref={modelIdInputRef}
                      type="text"
                      className={`form-input ${validationError ? 'input-error' : ''}`}
                      placeholder={t('settings.codexProvider.dialog.modelIdPlaceholder')}
                      value={newModelId}
                      onChange={(e) => {
                        setNewModelId(e.target.value);
                        if (validationError) setValidationError(null);
                        openSuggestions();
                      }}
                      onFocus={() => { if (newModelId.trim()) openSuggestions(); }}
                      onKeyDown={handleModelIdKeyDown}
                      style={FLEX_1_STYLE}
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={suggestionsOpen && suggestionResults.length > 0}
                      aria-controls={`model-id-input-suggestion-listbox`}
                      aria-activedescendant={
                        suggestionsOpen && activeSuggestion
                          ? `model-id-input-suggestion-${activeSuggestionIndex}`
                          : undefined
                      }
                      aria-invalid={!!validationError}
                      aria-describedby={validationError ? 'model-id-error' : undefined}
                    />
                    <ModelSuggestionDropdown
                      open={suggestionsOpen && (suggestionResults.length > 0 || suggestionsLoading || suggestionsUnavailable)}
                      query={newModelId}
                      results={suggestionResults}
                      loading={suggestionsLoading}
                      unavailable={suggestionsUnavailable}
                      onSelect={handleSelectSuggestion}
                      onClose={closeSuggestions}
                      inputId="model-id-input"
                    />
                  </div>
                  {capsLoading && (
                    <span style={SPINNER_STYLE} title={t('settings.pluginModels.lookingUp', { defaultValue: 'Looking up...' })}>
                      <span className="codicon codicon-loading codicon-modifier-spin" />
                    </span>
                  )}
                </div>
                <label htmlFor="model-label-input" className="sr-only">
                  {t('settings.codexProvider.dialog.modelLabelPlaceholder')}
                </label>
                <input
                  id="model-label-input"
                  type="text"
                  className="form-input"
                  placeholder={t('settings.codexProvider.dialog.modelLabelPlaceholder')}
                  value={newModelLabel}
                  onChange={(e) => setNewModelLabel(e.target.value)}
                  style={FLEX_1_STYLE}
                />
              </div>
              {validationError && (
                <div id="model-id-error" className={styles.validationError} role="alert">
                  {validationError}
                </div>
              )}
              <label htmlFor="model-desc-input" className="sr-only">
                {t('settings.codexProvider.dialog.modelDescPlaceholder')}
              </label>
              <input
                id="model-desc-input"
                type="text"
                className="form-input"
                placeholder={t('settings.codexProvider.dialog.modelDescPlaceholder')}
                value={newModelDesc}
                onChange={(e) => setNewModelDesc(e.target.value)}
                style={DESC_INPUT_STYLE}
              />
              <div className={styles.formRow} style={{ marginBottom: '4px' }}>
                <label htmlFor="model-context-input" style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '110px' }}>
                  {t('settings.pluginModels.contextWindow', { defaultValue: 'Context window' })}
                </label>
                <input
                  id="model-context-input"
                  type="number"
                  min="0"
                  step="1000"
                  className="form-input"
                  placeholder="200000"
                  value={contextWindowOverride}
                  onChange={(e) => setContextWindowOverride(e.target.value)}
                  style={FLEX_1_STYLE}
                />
              </div>

              {capabilities && (
                <div style={CAPS_PANEL_STYLE} data-testid="caps-panel">
                  <div style={{ marginBottom: '6px', color: 'var(--text-secondary)' }}>
                    {t('settings.pluginModels.openRouterFound', { defaultValue: 'OpenRouter match' })}: {capabilities.contextWindow.toLocaleString()} tokens
                    {capabilities.maxCompletionTokens ? ` · max output ${capabilities.maxCompletionTokens.toLocaleString()}` : ''}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    <CapabilityBadge label={t('settings.pluginModels.capImage', { defaultValue: 'image' })} present={capabilities.supportsImageInput} />
                    <CapabilityBadge label={t('settings.pluginModels.capAudio', { defaultValue: 'audio' })} present={capabilities.supportsAudioInput} />
                    <CapabilityBadge label={t('settings.pluginModels.capVideo', { defaultValue: 'video' })} present={capabilities.supportsVideoInput} />
                    <CapabilityBadge label={t('settings.pluginModels.capTools', { defaultValue: 'tools' })} present={capabilities.supportsToolUse} />
                    <CapabilityBadge label={t('settings.pluginModels.capStructured', { defaultValue: 'JSON' })} present={capabilities.supportsStructuredOutput} />
                    <CapabilityBadge label={t('settings.pluginModels.capReasoning', { defaultValue: 'reasoning' })} present={capabilities.supportsReasoning} />
                  </div>
                  {capabilities.pricing && (
                    <div style={{ marginTop: '6px', color: 'var(--text-tertiary)', fontSize: '11px' }}>
                      ${(capabilities.pricing.prompt * 1_000_000).toFixed(3)} / 1M input · ${(capabilities.pricing.completion * 1_000_000).toFixed(3)} / 1M output
                    </div>
                  )}
                </div>
              )}
              {!capabilities && !capsLoading && newModelId.trim() && notFound && (
                <div style={{ ...CAPS_PANEL_STYLE, color: 'var(--text-tertiary)' }} data-testid="notfound-panel">
                  {t('settings.pluginModels.openRouterNotFound', { defaultValue: 'No OpenRouter match for this id. Set context window manually.' })}
                </div>
              )}

              <div className={styles.formActions}>
                <button className="btn btn-secondary btn-sm" onClick={handleCancelEdit}>
                  {t('common.cancel')}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={editingModel ? handleSaveEdit : handleAddModel}
                  disabled={!newModelId.trim()}
                >
                  {editingModel ? t('common.save') : t('common.add')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${styles.addBtn}`}
              onClick={() => setIsAdding(true)}
              aria-label={t('settings.codexProvider.dialog.addModel')}
            >
              <span className="codicon codicon-add" aria-hidden="true" style={ADD_ICON_STYLE} />
              {t('settings.codexProvider.dialog.addModel')}
            </button>
          )}
        </div>

        <div className="dialog-footer">
          <div className={styles.dialogFooterSpacer} />
          <div className="footer-actions">
            <button className="btn btn-primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CustomModelDialog;
