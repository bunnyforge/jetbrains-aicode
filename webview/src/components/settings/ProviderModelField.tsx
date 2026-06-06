import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenRouterModel } from '../../services/openRouterCatalog';
import { useModelSearch } from '../../hooks/useModelSearch';
import { ModelSuggestionDropdown } from './CustomModelDialog/ModelSuggestionDropdown';
import { ProviderModelFieldCapability } from './ProviderModelFieldCapability';
import styles from './ProviderModelField.module.less';

const FLEX_1_STYLE: React.CSSProperties = { width: '100%' };

export interface ProviderModelFieldProps {
  id: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional aria-label override (defaults to placeholder). */
  ariaLabel?: string;
}

/**
 * Single-field wrapper used by the provider dialog's sonnet/opus/haiku
 * mapping inputs. Composes:
 *  - a combobox input (`role="combobox"`, `aria-autocomplete="list"`),
 *  - a live OpenRouter suggestion list powered by `useModelSearch` + the
 *    shared `ModelSuggestionDropdown`,
 *  - a row of capability pills (context / tools / image / file) with a
 *    "not in OpenRouter catalog" hint when applicable.
 *
 * The component is fully controlled — the parent owns the model id state
 * via `value` + `onChange`. Keyboard handling (ArrowUp/Down/Enter/Escape)
 * and click-outside behavior mirror the `CustomModelDialog` flow so the
 * two dialogs feel consistent.
 */
export function ProviderModelField({
  id,
  placeholder,
  value,
  onChange,
  ariaLabel,
}: ProviderModelFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suppressSuggestionOpen, setSuppressSuggestionOpen] = useState(false);

  const {
    results: suggestionResults,
    loading: suggestionsLoading,
    unavailable: suggestionsUnavailable,
  } = useModelSearch(value || null, 8);

  const activeSuggestion: OpenRouterModel | null =
    suggestionResults[activeIndex] ?? null;

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

  const handleSelectSuggestion = useCallback(
    (model: OpenRouterModel) => {
      onChange(model.id);
      closeSuggestions();
      setSuppressSuggestionOpen(true);
      inputRef.current?.focus();
    },
    [onChange, closeSuggestions]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!suggestionsOpen || suggestionResults.length === 0) {
        if (e.key === 'ArrowDown' && suggestionResults.length > 0) {
          e.preventDefault();
          setSuggestionsOpen(true);
          setActiveIndex(0);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((idx) => (idx + 1) % suggestionResults.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((idx) =>
          idx === 0 ? suggestionResults.length - 1 : idx - 1
        );
      } else if (e.key === 'Enter' && activeSuggestion) {
        e.preventDefault();
        handleSelectSuggestion(activeSuggestion);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSuggestions();
      }
    },
    [
      suggestionsOpen,
      suggestionResults,
      activeSuggestion,
      handleSelectSuggestion,
      closeSuggestions,
    ]
  );

  // Reset the active index whenever the result set changes so we never
  // highlight a row that no longer exists.
  useEffect(() => {
    if (activeIndex >= suggestionResults.length) {
      setActiveIndex(Math.max(0, suggestionResults.length - 1));
    }
  }, [suggestionResults.length, activeIndex]);

  // Click-outside handler — closes the suggestion list when the user
  // clicks anywhere outside the input wrapper.
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      closeSuggestions();
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [suggestionsOpen, closeSuggestions]);

  // ESC key handler — closes the dropdown but lets the parent dialog
  // handle the global Escape (closing the whole dialog).
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSuggestions();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [suggestionsOpen, closeSuggestions]);

  return (
    <div ref={wrapperRef} className={styles.fieldWrapper}>
      <div className={styles.inputWrapper}>
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="form-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            openSuggestions();
          }}
          onFocus={() => {
            if (value.trim()) openSuggestions();
          }}
          onKeyDown={handleKeyDown}
          style={FLEX_1_STYLE}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestionsOpen && suggestionResults.length > 0}
          aria-controls={`${id}-suggestion-listbox`}
          aria-activedescendant={
            suggestionsOpen && activeSuggestion
              ? `${id}-suggestion-${activeIndex}`
              : undefined
          }
          aria-label={ariaLabel ?? placeholder}
        />
        <ModelSuggestionDropdown
          open={
            suggestionsOpen &&
            (suggestionResults.length > 0 || suggestionsLoading || suggestionsUnavailable)
          }
          query={value}
          results={suggestionResults}
          loading={suggestionsLoading}
          unavailable={suggestionsUnavailable}
          onSelect={handleSelectSuggestion}
          onClose={closeSuggestions}
          inputId={id}
        />
      </div>
      <ProviderModelFieldCapability modelId={value} />
    </div>
  );
}

export default ProviderModelField;
