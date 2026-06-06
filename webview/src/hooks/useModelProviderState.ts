import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { sendBridgeEvent } from '../utils/bridge';
import {
  normalizeClaudeModelId,
} from '../components/ChatInputBox/types';
import type { PermissionMode, ReasoningEffort } from '../components/ChatInputBox/types';
import { isSpecialProviderId } from '../types/provider';
import { useClaudeProvider } from './providers/useClaudeProvider';
import { useUsageTracking } from './providers/useUsageTracking';
import { useProviderSettings } from './providers/useProviderSettings';
import { useModelStatePersistence } from './providers/useModelStatePersistence';
import { useModelCapabilities } from './useModelCapabilities';
import { resolveMappedModelName, readClaudeModelMapping } from '../utils/claudeModelMapping';

export type ViewMode = 'chat' | 'history' | 'settings';

export interface UseModelProviderStateOptions {
  addToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  t: TFunction;
}

/**
 * Orchestrates provider/model/permission state for the single Claude provider.
 * Composes Claude-specific state hooks, usage tracking, and provider settings,
 * then wires the cross-slice handlers (mode/model/provider switch,
 * always-thinking toggle, reasoning effort).
 *
 * The flat return shape is preserved as the public API: callers (App,
 * ChatScreen, AppDialogs, useMessageSender) destructure individual fields.
 *
 * `currentProviderRef` is exposed for window callbacks registered with stable
 * identity that must read the current provider when fired by the JCEF bridge.
 * The ref is updated via render-time assignment (no useEffect mirror).
 */
export function useModelProviderState({ addToast, t }: UseModelProviderStateOptions) {
  // ── Cross-slice state owned by the orchestrator ──
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypassPermissions');

  // External-facing ref so window callbacks can read the latest provider
  // without re-binding. Render-time assignment avoids the useRef + useEffect
  // mirror anti-pattern (rule 5.15).
  const currentProviderRef = useRef('claude');
  currentProviderRef.current = 'claude';

  // ── Provider-specific sub-hooks ──
  const claude = useClaudeProvider();
  const {
    isSdkInstalled,
    usageUsedTokens,
    setUsageMaxTokens,
    setUsagePercentage,
    ...usage
  } = useUsageTracking();
  const settings = useProviderSettings({ addToast, t });

  const {
    selectedClaudeModel, setSelectedClaudeModel,
    claudePermissionMode, setClaudePermissionMode,
    setClaudeSettingsAlwaysThinkingEnabled,
    reasoningEffort, setReasoningEffort,
  } = claude;

  // ── Persistence: load on mount + save on change ──
  useModelStatePersistence({
    setSelectedClaudeModel,
    setClaudePermissionMode,
    setPermissionMode,
    selectedClaudeModel,
    claudePermissionMode,
  });

  // ── Computed values ──
  const currentSdkInstalled = useMemo(
    () => isSdkInstalled('claude'),
    [isSdkInstalled],
  );

  // ── Active model id (resolves the Claude → third-party mapping) ──
  // We look up OpenRouter capabilities against the *effective* model id
  // (after mapping) so the context window and reasoning flags reflect the
  // model actually used at runtime, not the canonical Claude alias.
  const activeModelId = useMemo(() => {
    try {
      const mapping = readClaudeModelMapping();
      const resolved = resolveMappedModelName(selectedClaudeModel, mapping) ?? selectedClaudeModel;
      console.debug(`[useModelProviderState] activeModelId: selectedClaudeModel="${selectedClaudeModel}" resolved="${resolved}"`);
      return resolved;
    } catch (e) {
      console.debug(`[useModelProviderState] activeModelId: mapping lookup failed, using selectedClaudeModel="${selectedClaudeModel}":`, e);
      return selectedClaudeModel;
    }
  }, [selectedClaudeModel]);

  const { capabilities: activeModelCapabilities } = useModelCapabilities(activeModelId);

  // Default to `true` (Claude family + most third-party Anthropic-format
  // proxies accept images). Only flip to `false` once we have a confident
  // capabilities result that says the model does not accept images. The
  // `null` state during initial lookup stays permissive so the user can
  // still paste an image while the catalog is loading.
  const imageInputSupported = useMemo(() => {
    if (!activeModelCapabilities) return true;
    return activeModelCapabilities.supportsImageInput;
  }, [activeModelCapabilities]);

  const buildSetModelPayload = useCallback((modelId: string) => {
    const payload: { model: string; contextWindow?: number; resolvedModel?: string } = { model: modelId };
    if (activeModelCapabilities && activeModelCapabilities.contextWindow > 0) {
      payload.contextWindow = activeModelCapabilities.contextWindow;
    }
    if (activeModelId && activeModelId !== modelId) {
      payload.resolvedModel = activeModelId;
    }
    console.debug(`[useModelProviderState] buildSetModelPayload: model=${modelId}`
      + (payload.contextWindow ? ` contextWindow=${payload.contextWindow}` : '')
      + (payload.resolvedModel ? ` resolvedModel=${payload.resolvedModel}` : ''));
    return JSON.stringify(payload);
  }, [activeModelCapabilities, activeModelId]);

  // Re-sync `set_model` once OpenRouter capabilities resolve for the active
  // model so the backend context window reflects the real model (important
  // when a Claude alias is mapped to a third-party model with a different
  // context length, e.g. claude-sonnet-4-6 → minimax/minimax-m2.5).
  const enrichedModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeModelCapabilities || activeModelCapabilities.contextWindow <= 0) {
      console.debug('[useModelProviderState] enrichment: skipped (no capabilities)');
      return;
    }
    if (enrichedModelRef.current === activeModelId) {
      console.debug(`[useModelProviderState] enrichment: already enriched for activeModelId=${activeModelId}`);
      return;
    }
    enrichedModelRef.current = activeModelId;
    console.debug(`[useModelProviderState] enrichment: activeModelId=${activeModelId} contextWindow=${activeModelCapabilities.contextWindow} → re-sending set_model`);
    sendBridgeEvent('set_model', buildSetModelPayload(selectedClaudeModel));
  }, [activeModelCapabilities, activeModelId, selectedClaudeModel, buildSetModelPayload]);

  // Locally sync the context-window indicator (top-left ContextBar) when the
  // active model changes, so the displayed max reflects the new model
  // immediately rather than waiting for the next backend `onUsageUpdate`
  // (which only fires after a message round-trip).
  //
  // The max is taken from `activeModelCapabilities`, which is resolved
  // against `activeModelId` — the *real* model id after applying the
  // Claude → third-party mapping (e.g. claude-sonnet-4-6 → minimax/m2.5).
  // We do NOT use the Claude alias's default 200K window when a mapping
  // has been configured.
  //
  // The percentage is recomputed only if we already have a real used-token
  // count from a prior `onUsageUpdate`; if `usageUsedTokens` is undefined
  // (e.g. a fresh session), we leave the percentage at its current value
  // rather than fabricating a number from stale data.
  useEffect(() => {
    if (!activeModelCapabilities || activeModelCapabilities.contextWindow <= 0) {
      return;
    }
    const newMax = activeModelCapabilities.contextWindow;
    setUsageMaxTokens(newMax);
    if (typeof usageUsedTokens === 'number' && usageUsedTokens > 0) {
      const recomputed = Math.max(0, Math.min(100, (usageUsedTokens / newMax) * 100));
      setUsagePercentage(recomputed);
    }
  }, [activeModelId, activeModelCapabilities, setUsageMaxTokens, setUsagePercentage, usageUsedTokens]);

  // ── Cross-provider handlers ──
  const handleModeSelect = useCallback((mode: PermissionMode) => {
    setPermissionMode(mode);
    setClaudePermissionMode(mode);
    sendBridgeEvent('set_mode', mode);
  }, [setClaudePermissionMode]);

  const handleModelSelect = useCallback((modelId: string) => {
    const normalizedModelId = normalizeClaudeModelId(modelId);
    setSelectedClaudeModel(normalizedModelId);
    sendBridgeEvent('set_model', buildSetModelPayload(normalizedModelId));
  }, [setSelectedClaudeModel, buildSetModelPayload]);

  const handleProviderSelect = useCallback((_providerId: string) => {
    // Only Claude is supported; this is a no-op kept for API compatibility.
  }, []);

  const handleReasoningChange = useCallback((effort: ReasoningEffort) => {
    setReasoningEffort(effort);
    sendBridgeEvent('set_reasoning_effort', effort);
  }, [setReasoningEffort]);

  const handleToggleThinking = useCallback((enabled: boolean) => {
    const config = settings.activeProviderConfig;
    const isSpecialProvider = isSpecialProviderId(config?.id || '');

    setClaudeSettingsAlwaysThinkingEnabled(enabled);

    if (!config || isSpecialProvider) {
      settings.setActiveProviderConfig(prev => prev ? {
        ...prev,
        settingsConfig: {
          ...prev.settingsConfig,
          alwaysThinkingEnabled: enabled,
        },
      } : prev);
      sendBridgeEvent('set_thinking_enabled', JSON.stringify({ enabled }));
      addToast(enabled ? t('toast.thinkingEnabled') : t('toast.thinkingDisabled'), 'success');
      return;
    }

    settings.setActiveProviderConfig(prev => prev ? {
      ...prev,
      settingsConfig: {
        ...prev.settingsConfig,
        alwaysThinkingEnabled: enabled,
      },
    } : null);

    sendBridgeEvent('update_provider', JSON.stringify({
      id: config.id,
      updates: {
        settingsConfig: {
          ...(config.settingsConfig || {}),
          alwaysThinkingEnabled: enabled,
        },
      },
    }));
    addToast(enabled ? t('toast.thinkingEnabled') : t('toast.thinkingDisabled'), 'success');
  }, [settings, setClaudeSettingsAlwaysThinkingEnabled, addToast, t]);

  return {
    ...claude,
    ...usage,
    usageUsedTokens,
    setUsageMaxTokens,
    setUsagePercentage,
    ...settings,
    currentProvider: 'claude',
    selectedModel: selectedClaudeModel,
    activeModelId,
    reasoningEffort,
    permissionMode, setPermissionMode,
    currentSdkInstalled,
    currentProviderRef,
    activeModelCapabilities,
    imageInputSupported,
    handleModeSelect,
    handleModelSelect,
    handleProviderSelect,
    handleToggleThinking,
    handleReasoningChange,
  };
}
