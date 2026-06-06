import { useEffect, useMemo, useState } from 'react';
import { CLAUDE_MODELS, type ModelInfo } from '../../components/ChatInputBox/types';
import { STORAGE_KEYS } from '../../types/provider';
import {
  readClaudeModelMapping,
  resolveMappedModelName,
  type ClaudeModelMapping,
} from '../../utils/claudeModelMapping';

function readCustomModels(): ModelInfo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is { id: string; label?: string; description?: string } =>
          !!m && typeof m === 'object' && typeof m.id === 'string' && m.id.trim().length > 0
      )
      .map((m) => ({
        id: m.id,
        label: m.label?.trim() || m.id,
        description: m.description,
      }));
  } catch {
    return [];
  }
}

function applyMappingToBuiltIn(mapping: ClaudeModelMapping): ModelInfo[] {
  if (Object.keys(mapping).length === 0) {
    return CLAUDE_MODELS;
  }
  return CLAUDE_MODELS.map((m) => {
    const mapped = resolveMappedModelName(m.id, mapping);
    if (mapped) {
      return { ...m, label: mapped };
    }
    return m;
  });
}

function getStorageKey(event: Event): string | null {
  if (event instanceof StorageEvent) {
    return event.key;
  }
  const detail = (event as CustomEvent<{ key: string }>).detail;
  return detail?.key ?? null;
}

/**
 * Hook that returns the merged list of Claude models for selection UI.
 *
 * Resulting order:
 *   1. User-defined custom models (from `claude-custom-models` localStorage)
 *   2. Built-in `CLAUDE_MODELS` with mapping applied (mapping remaps labels only;
 *      model ids are preserved so backend requests stay stable)
 *
 * The hook re-renders when either `claude-custom-models` or
 * `claude-model-mapping` localStorage entries change in any tab or in the
 * current tab (the latter via a custom `localStorageChange` event).
 *
 * Model-id-to-mapping-key resolution is delegated to
 * `MODEL_ID_TO_MAPPING_KEY` / `resolveMappedModelName` in `claudeModelMapping.ts`
 * so the chat input dropdown and this hook stay in lockstep.
 */
export function useAvailableClaudeModels(): ModelInfo[] {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const key = getStorageKey(e);
      if (
        key === STORAGE_KEYS.CLAUDE_CUSTOM_MODELS ||
        key === STORAGE_KEYS.CLAUDE_MODEL_MAPPING
      ) {
        setVersion((v) => v + 1);
      }
    };
    window.addEventListener('storage', handler);
    window.addEventListener('localStorageChange', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('localStorageChange', handler);
    };
  }, []);

  return useMemo<ModelInfo[]>(() => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return CLAUDE_MODELS;
    }

    let builtIn: ModelInfo[];
    try {
      builtIn = applyMappingToBuiltIn(readClaudeModelMapping());
    } catch {
      builtIn = CLAUDE_MODELS;
    }

    const customModels = readCustomModels();
    if (customModels.length === 0) {
      return builtIn;
    }

    const customIds = new Set(customModels.map((m) => m.id));
    return [...customModels, ...builtIn.filter((m) => !customIds.has(m.id))];
  }, [version]);
}
