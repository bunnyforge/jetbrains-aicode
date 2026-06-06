import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  REASONING_LEVELS,
  EFFORT_SUPPORTED_CLAUDE_MODELS,
  MAX_EFFORT_CLAUDE_MODELS,
  XHIGH_EFFORT_CLAUDE_MODELS,
  type ReasoningEffort,
} from '../types';
import { useModelCapabilities } from '../../../hooks/useModelCapabilities';
import { resolveMappedModelName, readClaudeModelMapping } from '../../../utils/claudeModelMapping';

const RELATIVE_INLINE_BLOCK_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };
const CHEVRON_ICON_STYLE: React.CSSProperties = { fontSize: '10px', marginLeft: '2px' };
const DROPDOWN_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  right: 0,
  marginBottom: '4px',
  zIndex: 10000,
};
const LEVEL_DOT_COUNT: Record<ReasoningEffort, number> = {
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

interface ReasoningSelectProps {
  value: ReasoningEffort;
  enabled: boolean;
  onChange: (effort: ReasoningEffort) => void;
  onEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
  selectedModel?: string;
  currentProvider?: string;
}

/**
 * ReasoningSelect - Reasoning toggle + optional level selector.
 *
 * Visibility and available levels are resolved in this order:
 *  1. OpenRouter capabilities for the *effective* (mapping-resolved) model id.
 *     If the catalog reports reasoning support, the catalog's `reasoningLevels`
 *     are the source of truth (e.g. minimax/minimax-m2.5 → low/medium/high).
 *  2. Hardcoded Claude model sets (Opus 4.7 has xhigh, etc.).
 *  3. Default: hide the selector (unknown model without capability data).
 *
 * Render:
 *  - Always: a single icon toggle button (lightbulb-sparkle / lightbulb-empty).
 *  - Inside the panel: a fixed-width header with the toggle switch, then a
 *    level list that is ALWAYS rendered (with the disabled visual state when
 *    the toggle is off) so the panel never resizes when toggling.
 *  - Models with a single level expose only the toggle (level is implicit).
 */
export const ReasoningSelect = ({
  value,
  enabled,
  onChange,
  onEnabledChange,
  disabled,
  selectedModel,
  currentProvider,
}: ReasoningSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const effectiveModelId = useMemo(() => {
    if (!selectedModel) return '';
    try {
      const mapping = readClaudeModelMapping();
      return resolveMappedModelName(selectedModel, mapping) ?? selectedModel;
    } catch {
      return selectedModel;
    }
  }, [selectedModel]);

  const { capabilities } = useModelCapabilities(effectiveModelId);

  const { isVisible, availableLevels } = useMemo(() => {
    if (capabilities) {
      const levels = Array.isArray(capabilities.reasoningLevels) ? capabilities.reasoningLevels : [];
      if (levels.length > 0) {
        return {
          isVisible: true,
          availableLevels: REASONING_LEVELS.filter(l => levels.includes(l.id)),
        };
      }
      if (!capabilities.supportsReasoning) {
        return { isVisible: false, availableLevels: [] as typeof REASONING_LEVELS };
      }
    }
    const visible = currentProvider !== 'claude' || !selectedModel || EFFORT_SUPPORTED_CLAUDE_MODELS.has(selectedModel);
    if (!visible) {
      return { isVisible: false, availableLevels: [] as typeof REASONING_LEVELS };
    }
    const levels = REASONING_LEVELS.filter(level => {
      if (currentProvider !== 'claude') {
        return level.id !== 'max';
      }
      if (!selectedModel) {
        return true;
      }
      if (level.id === 'xhigh') {
        return XHIGH_EFFORT_CLAUDE_MODELS.has(selectedModel);
      }
      if (level.id === 'max') {
        return MAX_EFFORT_CLAUDE_MODELS.has(selectedModel);
      }
      return true;
    });
    return { isVisible: true, availableLevels: levels };
  }, [capabilities, currentProvider, selectedModel]);

  const currentLevel = useMemo(
    () =>
      availableLevels.find(l => l.id === value) ??
      availableLevels[availableLevels.length - 2] ??
      availableLevels[0],
    [availableLevels, value],
  );

  // Auto-correct the level if the model drops support for the current value.
  useEffect(() => {
    if (!isVisible) return;
    if (availableLevels.some(level => level.id === value)) return;
    if (currentLevel) {
      onChange(currentLevel.id);
    }
  }, [availableLevels, currentLevel, isVisible, onChange, value]);

  // Single-level models: level is implicit, keep it in sync with the model.
  useEffect(() => {
    if (!isVisible) return;
    if (availableLevels.length === 1 && availableLevels[0].id !== value) {
      onChange(availableLevels[0].id);
    }
  }, [availableLevels, isVisible, onChange, value]);

  const getReasoningText = (levelId: ReasoningEffort, field: 'label' | 'description') => {
    const key = `reasoning.${levelId}.${field}`;
    const fallback = REASONING_LEVELS.find(l => l.id === levelId)?.[field] || levelId;
    return t(key, { defaultValue: fallback });
  };

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setIsOpen(!isOpen);
  }, [isOpen, disabled]);

  const handleSelect = useCallback((effort: ReasoningEffort) => {
    onChange(effort);
  }, [onChange]);

  const handleEnabledToggle = useCallback((next: boolean) => {
    onEnabledChange(next);
  }, [onEnabledChange]);

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

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!isVisible) return null;

  const hasMultipleLevels = availableLevels.length > 1;
  const showLevels = hasMultipleLevels;
  const tooltip = enabled
    ? t('reasoning.tooltipOn', {
        defaultValue: 'Reasoning: {{level}}',
        level: hasMultipleLevels ? getReasoningText(currentLevel.id, 'label') : t('reasoning.headerLabel', { defaultValue: 'Reasoning' }),
      })
    : t('reasoning.tooltipOff', { defaultValue: 'Reasoning off' });
  const headerLabel = t('reasoning.headerLabel', { defaultValue: 'Reasoning' });
  const headerHint = t('reasoning.headerHint', { defaultValue: 'Show thinking' });
  const depthLabel = t('reasoning.depthLabel', { defaultValue: 'Depth' });

  return (
    <div style={RELATIVE_INLINE_BLOCK_STYLE}>
      <button
        ref={buttonRef}
        className={`selector-button reasoning-toggle ${enabled ? 'active' : ''}`}
        onClick={handleToggle}
        disabled={disabled}
        title={tooltip}
        aria-pressed={enabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className={`codicon ${enabled ? 'codicon-lightbulb-sparkle' : 'codicon-lightbulb-empty'}`} />
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={CHEVRON_ICON_STYLE} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="selector-dropdown reasoning-dropdown"
          style={DROPDOWN_STYLE}
          role="menu"
        >
          <div className="reasoning-header">
            <div className="reasoning-header-text">
              <span className="reasoning-header-label">{headerLabel}</span>
              <span className="reasoning-header-hint">{headerHint}</span>
            </div>
            <label
              className="reasoning-switch"
              onClick={(e) => e.stopPropagation()}
              title={enabled
                ? t('reasoning.disableHint', { defaultValue: 'Disable reasoning' })
                : t('reasoning.enableHint', { defaultValue: 'Enable reasoning' })}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => handleEnabledToggle(e.target.checked)}
                aria-label={headerLabel}
              />
              <span className="reasoning-switch-track">
                <span className="reasoning-switch-knob" />
              </span>
            </label>
          </div>

          {showLevels && (
            <>
              <div className="reasoning-divider" />
              <div className="reasoning-section-label">{depthLabel}</div>
              <div className={`reasoning-levels ${enabled ? '' : 'disabled'}`}>
                {availableLevels.map((level) => {
                  const dotCount = LEVEL_DOT_COUNT[level.id] ?? 1;
                  const isSelected = level.id === value;
                  return (
                    <div
                      key={level.id}
                      className={`reasoning-level ${isSelected ? 'selected' : ''}`}
                      onClick={() => enabled && handleSelect(level.id)}
                      title={getReasoningText(level.id, 'description')}
                      role="menuitemradio"
                      aria-checked={isSelected}
                      aria-disabled={!enabled}
                    >
                      <span className="reasoning-dots" aria-hidden="true">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <span
                            key={i}
                            className="reasoning-dot"
                            style={{ opacity: i < dotCount ? 1 : 0.25 }}
                          />
                        ))}
                      </span>
                      <div className="reasoning-level-text">
                        <span className="reasoning-level-label">{getReasoningText(level.id, 'label')}</span>
                        <span className="reasoning-level-desc">{getReasoningText(level.id, 'description')}</span>
                      </div>
                      {isSelected && <span className="codicon codicon-check reasoning-level-check" />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ReasoningSelect;
