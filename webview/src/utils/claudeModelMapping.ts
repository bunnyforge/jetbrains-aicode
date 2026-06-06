import { STORAGE_KEYS } from '../types/provider';

/**
 * Claude model mapping configuration.
 */
export interface ClaudeModelMapping {
  main?: string;
  haiku?: string;
  sonnet?: string;
  opus?: string;
  [key: string]: string | undefined;
}

/**
 * Single source of truth mapping a Claude model id to the key used inside
 * `ClaudeModelMapping`. Legacy `claude-opus-4-6` and its 1M-context variant
 * both point at the `opus` bucket so the user only has to configure one
 * placeholder per model family.
 */
export const MODEL_ID_TO_MAPPING_KEY: Record<string, keyof ClaudeModelMapping> = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-8': 'opus',
  'claude-opus-4-7': 'opus',
  'claude-opus-4-6': 'opus',
  'claude-opus-4-6[1m]': 'opus',
  'claude-haiku-4-5': 'haiku',
};

/**
 * Resolve the display name for a Claude model id against the active mapping.
 * Returns `undefined` when the id is not a known Claude model or no mapping
 * value is set for it.
 */
export function resolveMappedModelName(
  modelId: string,
  mapping: ClaudeModelMapping
): string | undefined {
  const key = MODEL_ID_TO_MAPPING_KEY[modelId];
  if (key) {
    const direct = mapping[key];
    if (direct && direct.trim().length > 0) {
      return direct.trim();
    }
  }
  const main = mapping.main;
  return main && main.trim().length > 0 ? main.trim() : undefined;
}

/**
 * Read the Claude model mapping.
 */
export function readClaudeModelMapping(): ClaudeModelMapping {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CLAUDE_MODEL_MAPPING);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? parsed as ClaudeModelMapping : {};
  } catch {
    return {};
  }
}

/**
 * Check whether the mapping contains at least one valid model value.
 */
function hasMappingValue(mapping: ClaudeModelMapping): boolean {
  return Object.values(mapping).some(value => value && value.trim().length > 0);
}

/**
 * Write the Claude model mapping and proactively notify listeners in the same tab to refresh.
 */
export function writeClaudeModelMapping(mapping: ClaudeModelMapping): void {
  try {
    if (hasMappingValue(mapping)) {
      localStorage.setItem(STORAGE_KEYS.CLAUDE_MODEL_MAPPING, JSON.stringify(mapping));
    } else {
      localStorage.removeItem(STORAGE_KEYS.CLAUDE_MODEL_MAPPING);
    }

    // localStorage writes in the same tab do not trigger the native storage event, so dispatch one manually here.
    window.dispatchEvent(new CustomEvent('localStorageChange', {
      detail: { key: STORAGE_KEYS.CLAUDE_MODEL_MAPPING },
    }));
  } catch {
    // Gracefully degrade when localStorage is unavailable or the write fails
  }
}
