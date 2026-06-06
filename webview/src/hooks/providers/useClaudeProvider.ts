import { useState } from 'react';
import { CLAUDE_MODELS, type ReasoningEffort } from '../../components/ChatInputBox/types';
import type { PermissionMode } from '../../components/ChatInputBox/types';

/**
 * Claude-specific selectable state. State only — handlers that span providers
 * (mode/model/provider switching) live in the orchestrator
 * (useModelProviderState) since they need to read both Claude-only state.
 */
export function useClaudeProvider() {
  const [selectedClaudeModel, setSelectedClaudeModel] = useState(CLAUDE_MODELS[0].id);
  const [claudePermissionMode, setClaudePermissionMode] = useState<PermissionMode>('bypassPermissions');
  const [claudeSettingsAlwaysThinkingEnabled, setClaudeSettingsAlwaysThinkingEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('high');

  return {
    selectedClaudeModel,
    setSelectedClaudeModel,
    claudePermissionMode,
    setClaudePermissionMode,
    claudeSettingsAlwaysThinkingEnabled,
    setClaudeSettingsAlwaysThinkingEnabled,
    reasoningEffort,
    setReasoningEffort,
  };
}

export type UseClaudeProviderReturn = ReturnType<typeof useClaudeProvider>;
