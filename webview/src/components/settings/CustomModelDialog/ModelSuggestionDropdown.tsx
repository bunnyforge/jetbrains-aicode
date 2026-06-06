import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeModelId, tokenizeModelId, type OpenRouterModel } from '../../../services/openRouterCatalog';
import styles from '../modelSuggestions.module.less';

export interface ModelSuggestionDropdownProps {
  /** Whether the dropdown is open. Parent controls visibility. */
  open: boolean;
  /** Current input value — used to compute highlighted tokens. */
  query: string;
  /** The list of matches, already ranked, to display. */
  results: ReadonlyArray<OpenRouterModel>;
  /** True while the debounced search is in flight. */
  loading: boolean;
  /** True when the catalog could not be loaded. */
  unavailable: boolean;
  /** Invoked when the user picks a suggestion. */
  onSelect: (model: OpenRouterModel) => void;
  /** Invoked when the user requests closing (Escape, click outside, etc). */
  onClose: () => void;
  /** id of the input that owns this dropdown (used by aria-controls). */
  inputId: string;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const queryNormalized = normalizeModelId(trimmed);
  const textNormalized = normalizeModelId(text);
  if (!queryNormalized || !textNormalized) return text;

  // Walk the original text in lockstep with its normalized form so we can
  // wrap only the substrings that correspond to the matched query tokens.
  const queryTokens = new Set(tokenizeModelId(trimmed));
  const out: React.ReactNode[] = [];
  let buf = '';
  let bufNorm = '';
  let key = 0;
  const flush = () => {
    if (!buf) return;
    out.push(<span key={`t-${key++}`}>{buf}</span>);
    buf = '';
    bufNorm = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const normCh = /[A-Za-z0-9]/.test(ch) ? ch.toLowerCase() : '';
    const nextNorm = bufNorm + normCh;
    // Detect the end of a token: when the normalized accumulator stops being
    // a prefix of the next token to match, flush the buffer and mark it.
    const endsAtToken = !normCh || !queryNormalized.startsWith(nextNorm) && queryTokens.size > 0;
    if (endsAtToken) {
      // Check if the buffered normalized text corresponds to a query token
      // (exact or prefix) — if so, push as <mark>, otherwise as text.
      const isMatch =
        queryTokens.has(bufNorm) ||
        Array.from(queryTokens).some((qt) => qt.length >= 2 && bufNorm.length > 0 && qt.startsWith(bufNorm));
      if (isMatch) {
        out.push(<mark key={`m-${key++}`}>{buf}</mark>);
      } else {
        out.push(<span key={`t-${key++}`}>{buf}</span>);
      }
      buf = '';
      bufNorm = '';
    }
    buf += ch;
    bufNorm += normCh;
  }
  flush();
  // Tail buffer
  if (buf) {
    const isMatch =
      queryTokens.has(bufNorm) ||
      Array.from(queryTokens).some((qt) => qt.length >= 2 && bufNorm.length > 0 && qt.startsWith(bufNorm));
    if (isMatch) {
      out.push(<mark key={`m-${key++}`}>{buf}</mark>);
    } else {
      out.push(<span key={`t-${key++}`}>{buf}</span>);
    }
  }
  return <>{out}</>;
}

/**
 * Live suggestion list rendered under the custom model id input. Selection
 * is driven externally (parent component owns the input + keyboard
 * handling); this component only owns the list itself plus the active-row
 * index used by arrow-key navigation forwarded from the parent.
 */
export function ModelSuggestionDropdown({
  open,
  query,
  results,
  loading,
  unavailable,
  onSelect,
  onClose: _onClose,
  inputId,
}: ModelSuggestionDropdownProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Clamp the active index whenever the result list shrinks/changes so we
  // never highlight a row that no longer exists.
  useEffect(() => {
    if (activeIndex >= results.length) {
      setActiveIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, activeIndex]);

  // Reset to first row whenever the user starts a new query.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active row in view as the user navigates.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLLIElement>(
      `[data-suggestion-index="${activeIndex}"]`
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const listboxId = useMemo(() => `${inputId}-suggestion-listbox`, [inputId]);

  if (!open) return null;

  const showEmpty = !loading && !unavailable && results.length === 0;
  const showUnavailable = !loading && unavailable;

  return (
    <div
      className={styles.suggestionDropdown}
      role="listbox"
      id={listboxId}
      aria-label={t('settings.pluginModels.suggestionsHeader')}
    >
      <div className={styles.suggestionHeader}>
        <span>{t('settings.pluginModels.suggestionsHeader')}</span>
        {loading && (
          <span
            className={`${styles.suggestionSpinner} codicon codicon-loading codicon-modifier-spin`}
            aria-hidden="true"
          />
        )}
      </div>
      {showEmpty && (
        <div className={styles.suggestionEmpty}>
          {t('settings.pluginModels.suggestionsEmpty')}
        </div>
      )}
      {showUnavailable && (
        <div className={styles.suggestionEmpty}>
          {t('settings.pluginModels.suggestionsUnavailable')}
        </div>
      )}
      {results.length > 0 && (
        <ul className={styles.suggestionList} ref={listRef}>
          {results.map((model, idx) => {
            const active = idx === activeIndex;
            return (
              <li
                key={`${model.id}-${idx}`}
                id={`${inputId}-suggestion-${idx}`}
                role="option"
                aria-selected={active}
                data-suggestion-index={idx}
                className={`${styles.suggestionItem} ${active ? styles.suggestionItemActive : ''}`}
                onMouseDown={(e) => {
                  // mousedown (not click) so the input's blur handler doesn't
                  // dismiss us before the selection is applied.
                  e.preventDefault();
                  onSelect(model);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                title={model.id}
              >
                <span className={styles.suggestionItemId}>
                  {highlightMatch(model.id, query)}
                </span>
                {model.name && model.name !== model.id && (
                  <span className={styles.suggestionItemName}>{model.name}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.suggestionHint}>
        {t('settings.pluginModels.suggestionsUseHint')}
      </div>
    </div>
  );
}

export default ModelSuggestionDropdown;
