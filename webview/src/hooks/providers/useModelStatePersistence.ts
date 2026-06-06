import { useEffect } from 'react';
import { sendBridgeEvent } from '../../utils/bridge';
import {
  CLAUDE_MODELS,
  isValidPermissionMode,
  normalizeClaudeModelId,
} from '../../components/ChatInputBox/types';
import type { PermissionMode } from '../../components/ChatInputBox/types';

const STORAGE_KEY = 'model-selection-state';

const getCustomModels = (key: string): { id: string }[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export interface UseModelStatePersistenceOptions {
  // Cross-slice load setters (run once on mount)
  setSelectedClaudeModel: (value: string) => void;
  setClaudePermissionMode: (value: PermissionMode) => void;
  setPermissionMode: (value: PermissionMode) => void;
  // Cross-slice save deps (re-saves on any change)
  selectedClaudeModel: string;
  claudePermissionMode: PermissionMode;
}

/**
 * Two effects for persisting Claude model state to localStorage:
 *  1. On mount: hydrate state from localStorage and sync the restored values
 *     to the backend (retrying until the JCEF bridge is ready).
 *  2. On change: re-save the snapshot to localStorage.
 *
 * Save uses `JSON.stringify` of the persisted keys; load applies
 * defensive validation (custom models lookup, permission mode allowlist)
 * before invoking the slice setters.
 */
export function useModelStatePersistence(options: UseModelStatePersistenceOptions) {
  const {
    setSelectedClaudeModel,
    setClaudePermissionMode,
    setPermissionMode,
    selectedClaudeModel,
    claudePermissionMode,
  } = options;

  // Hydrate from localStorage and sync to backend (mount only).
  // Setters are stable; deps left empty to ensure single execution.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      let restoredClaudeModel = CLAUDE_MODELS[0].id;
      let restoredClaudePermissionMode: PermissionMode = 'bypassPermissions';

      if (saved) {
        const state = JSON.parse(saved);

        if (isValidPermissionMode(state.claudePermissionMode)) {
          restoredClaudePermissionMode = state.claudePermissionMode;
        }

        const savedClaudeCustomModels = getCustomModels('claude-custom-models');
        const normalizedClaudeModel = normalizeClaudeModelId(state.claudeModel);
        if (
          CLAUDE_MODELS.find(m => m.id === normalizedClaudeModel) ||
          savedClaudeCustomModels.find(m => m.id === normalizedClaudeModel)
        ) {
          restoredClaudeModel = normalizedClaudeModel;
          setSelectedClaudeModel(normalizedClaudeModel);
        }
      }

      setClaudePermissionMode(restoredClaudePermissionMode);
      setPermissionMode(restoredClaudePermissionMode);

      let syncRetryCount = 0;
      const MAX_SYNC_RETRIES = 30;

      const syncToBackend = () => {
        if (window.sendToJava) {
          sendBridgeEvent('set_provider', 'claude');
          sendBridgeEvent('set_model', restoredClaudeModel);
          sendBridgeEvent('set_mode', restoredClaudePermissionMode);
        } else {
          syncRetryCount++;
          if (syncRetryCount < MAX_SYNC_RETRIES) {
            setTimeout(syncToBackend, 100);
          }
        }
      };
      setTimeout(syncToBackend, 200);
    } catch {
      // Failed to load model selection state — fall back to defaults already
      // set by individual slice hooks.
    }
  }, []);

  // Persist snapshot whenever any of the keys change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        provider: 'claude',
        claudeModel: selectedClaudeModel,
        claudePermissionMode,
      }));
    } catch {
      // Failed to save model selection state — non-fatal.
    }
  }, [
    selectedClaudeModel,
    claudePermissionMode,
  ]);
}
