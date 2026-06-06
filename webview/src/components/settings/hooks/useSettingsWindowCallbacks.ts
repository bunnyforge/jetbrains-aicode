// hooks/useSettingsWindowCallbacks.ts
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderConfig } from '../../../types/provider';
import type { CommitAiConfig } from '../../../types/aiFeatureConfig';
import type { UiFontConfig, CodeFontConfig } from './useSettingsBasicActions';
import type { AlertType } from '../../AlertDialog';
import type { ToastMessage } from '../../Toast';
import {
  subscribeActiveProvider,
  subscribeProviderList,
} from '../../../utils/runtimeProviderCapabilities';

const sendToJava = (message: string) => {
  if (window.sendToJava) {
    window.sendToJava(message);
  }
};

export interface SettingsWindowCallbacksDeps {
  // State setters
  setNodePath: (path: string) => void;
  setNodeVersion: (version: string | null) => void;
  setMinNodeVersion: (version: number) => void;
  setSavingNodePath: (saving: boolean) => void;
  setClaudeCliPath: (path: string) => void;
  setSavingClaudeCliPath: (saving: boolean) => void;
  setWorkingDirectory: (dir: string) => void;
  setSavingWorkingDirectory: (saving: boolean) => void;
  setCommitPrompt: (prompt: string) => void;
  setSavingCommitPrompt: (saving: boolean) => void;
  setCommitAiConfig: (config: CommitAiConfig) => void;
  setProjectCommitPrompt: (prompt: string) => void;
  setSavingProjectCommitPrompt: (saving: boolean) => void;
  setEditorFontConfig: (config: { fontFamily: string; fontSize: number; lineSpacing: number } | undefined) => void;
  setUiFontConfig: (config: UiFontConfig | undefined) => void;
  setCodeFontConfig: (config: CodeFontConfig | undefined) => void;
  setIdeTheme: (theme: 'light' | 'dark' | null) => void;
  setLocalStreamingEnabled: (enabled: boolean) => void;
  setLocalSendShortcut: (shortcut: 'enter' | 'cmdEnter') => void;
  setLoading: (loading: boolean) => void;
  // AI feature toggle setters
  setCommitGenerationEnabled?: (enabled: boolean) => void;
  setAiTitleGenerationEnabled?: (enabled: boolean) => void;
  setStatusBarWidgetEnabled?: (enabled: boolean) => void;
  setTaskCompletionNotificationEnabled?: (enabled: boolean) => void;
  // Sound notification setters
  setSoundNotificationEnabled?: (enabled: boolean) => void;
  setSoundOnlyWhenUnfocused?: (enabled: boolean) => void;
  setSelectedSound?: (soundId: string) => void;
  setCustomSoundPath?: (path: string) => void;

  // Hook functions
  updateProviders: (providers: ProviderConfig[]) => void;
  updateActiveProvider: (provider: ProviderConfig) => void;
  loadProviders: () => void;

  // Callbacks
  showAlert: (type: AlertType, title: string, message: string) => void;
  addToast: (message: string, type?: ToastMessage['type']) => void;

  // Props
  onStreamingEnabledChangeProp?: (enabled: boolean) => void;
  onSendShortcutChangeProp?: (shortcut: 'enter' | 'cmdEnter') => void;
}

/**
 * Registers window callbacks for Java bridge communication in settings view.
 * Handles provider, agent, prompt, config, and theme callbacks.
 */
export function useSettingsWindowCallbacks(deps: SettingsWindowCallbacksDeps) {
  const { t } = useTranslation();

  // Use ref to avoid stale closures - callbacks always read latest deps
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const d = () => depsRef.current;

    // Provider callbacks - subscribe to the registry instead of overriding
    // window callbacks directly. This keeps behavior deterministic when
    // multiple consumers (e.g. RuntimeProviderSelect) are mounted.
    const unsubscribeProviders = subscribeProviderList((jsonStr: string) => {
      try {
        const providersList: ProviderConfig[] = JSON.parse(jsonStr);
        d().updateProviders(providersList);
      } catch (error) {
        console.error('[SettingsView] Failed to parse providers:', error);
        d().setLoading(false);
      }
    });

    const unsubscribeActiveProvider = subscribeActiveProvider((jsonStr: string) => {
      try {
        const activeProvider: ProviderConfig = JSON.parse(jsonStr);
        if (activeProvider) {
          d().updateActiveProvider(activeProvider);
        }
      } catch (error) {
        console.error('[SettingsView] Failed to parse active provider:', error);
      }
    });

    window.showError = (message: string) => {
      d().showAlert('error', t('toast.operationFailed'), message);
      d().setLoading(false);
      d().setSavingNodePath(false);
      d().setSavingClaudeCliPath(false);
      d().setSavingWorkingDirectory(false);
      d().setSavingCommitPrompt(false);
      d().setSavingProjectCommitPrompt(false);
    };

    window.showSwitchSuccess = (message: string) => {
      d().showAlert('success', t('toast.switchSuccess'), message);
    };

    window.updateNodePath = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setNodePath(data.path || '');
        d().setNodeVersion(data.version || null);
        if (data.minVersion) {
          d().setMinNodeVersion(data.minVersion);
        }
      } catch (e) {
        console.warn('[SettingsView] Failed to parse updateNodePath JSON, fallback to legacy format:', e);
        d().setNodePath(jsonStr || '');
      }
      d().setSavingNodePath(false);
      window.dispatchEvent(new CustomEvent('nodePathReady'));
    };

    window.updateClaudeCliPath = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setClaudeCliPath(data.path || '');
      } catch (e) {
        console.warn('[SettingsView] Failed to parse updateClaudeCliPath JSON, fallback to legacy format:', e);
        d().setClaudeCliPath(jsonStr || '');
      }
      d().setSavingClaudeCliPath(false);
    };

    window.updateWorkingDirectory = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setWorkingDirectory(data.customWorkingDir || '');
        d().setSavingWorkingDirectory(false);
      } catch (error) {
        console.error('[SettingsView] Failed to parse working directory:', error);
        d().setSavingWorkingDirectory(false);
      }
    };

    window.showSuccess = (message: string) => {
      d().showAlert('success', t('toast.operationSuccess'), message);
      d().setSavingNodePath(false);
      d().setSavingClaudeCliPath(false);
      d().setSavingWorkingDirectory(false);
    };

    window.showSuccessI18n = (i18nKey: string) => {
      const message = t(i18nKey);
      d().addToast(message, 'success');
    };

    window.onEditorFontConfigReceived = (jsonStr: string) => {
      try {
        const config = JSON.parse(jsonStr);
        d().setEditorFontConfig(config);
      } catch (error) {
        console.error('[SettingsView] Failed to parse editor font config:', error);
      }
    };

    window.onUiFontConfigReceived = (jsonStr: string) => {
      try {
        const config = JSON.parse(jsonStr);
        d().setUiFontConfig(config);
        window.applyUiFontConfig?.(config);
      } catch {
        // Silently ignore malformed UI font config from backend
      }
    };

    window.onCodeFontConfigReceived = (jsonStr: string) => {
      try {
        const config = JSON.parse(jsonStr);
        d().setCodeFontConfig(config);
        window.applyCodeFontConfig?.(config);
      } catch {
        // Silently ignore malformed code font config from backend
      }
    };

    // IDE theme callback
    const previousOnIdeThemeReceived = window.onIdeThemeReceived;
    window.onIdeThemeReceived = (jsonStr: string) => {
      try {
        const themeData = JSON.parse(jsonStr);
        const theme = themeData.isDark ? 'dark' : 'light';
        d().setIdeTheme(theme);
        previousOnIdeThemeReceived?.(jsonStr);
      } catch (error) {
        console.error('[SettingsView] Failed to parse IDE theme:', error);
      }
    };

    // Streaming configuration callback
    const previousUpdateStreamingEnabled = window.updateStreamingEnabled;
    if (!d().onStreamingEnabledChangeProp) {
      window.updateStreamingEnabled = (jsonStr: string) => {
        try {
          const data = JSON.parse(jsonStr);
          d().setLocalStreamingEnabled(data.streamingEnabled ?? true);
        } catch (error) {
          console.error('[SettingsView] Failed to parse streaming config:', error);
        }
      };
    }

    // Send shortcut configuration callback
    const previousUpdateSendShortcut = window.updateSendShortcut;
    if (!d().onSendShortcutChangeProp) {
      window.updateSendShortcut = (jsonStr: string) => {
        try {
          const data = JSON.parse(jsonStr);
          d().setLocalSendShortcut(data.sendShortcut ?? 'enter');
        } catch (error) {
          console.error('[SettingsView] Failed to parse send shortcut config:', error);
        }
      };
    }

    // Commit AI prompt callback
    window.updateCommitPrompt = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setCommitPrompt(data.commitPrompt || '');
        d().setSavingCommitPrompt(false);
        if (data.projectCommitPrompt !== undefined) {
          d().setProjectCommitPrompt(data.projectCommitPrompt || '');
        }
        if (data.saved) {
          d().addToast(t('toast.saveSuccess'), 'success');
        }
      } catch (error) {
        console.error('[SettingsView] Failed to parse commit prompt:', error);
        d().setSavingCommitPrompt(false);
        d().addToast(t('toast.saveFailed'), 'error');
      }
    };

    window.updateCommitAiConfig = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setCommitAiConfig(data);
      } catch (error) {
        console.error('[SettingsView] Failed to parse commit AI config:', error);
      }
    };

    // Project-level commit AI prompt callback
    window.updateProjectCommitPrompt = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setProjectCommitPrompt(data.projectCommitPrompt || '');
        d().setSavingProjectCommitPrompt(false);
        if (data.saved) {
          d().addToast(t('toast.saveSuccess'), 'success');
        }
      } catch (error) {
        console.error('[SettingsView] Failed to parse project commit prompt:', error);
        d().setSavingProjectCommitPrompt(false);
        d().addToast(t('toast.saveFailed'), 'error');
      }
    };

    // AI commit generation config callback
    window.updateCommitGenerationEnabled = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setCommitGenerationEnabled?.(data.commitGenerationEnabled ?? true);
      } catch (error) {
        console.error('[SettingsView] Failed to parse commit generation config:', error);
      }
    };

    // AI session title generation config callback
    window.updateAiTitleGenerationEnabled = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setAiTitleGenerationEnabled?.(data.aiTitleGenerationEnabled ?? true);
      } catch (error) {
        console.error('[SettingsView] Failed to parse AI title generation config:', error);
      }
    };

    // Status bar widget config callback
    window.updateStatusBarWidgetEnabled = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setStatusBarWidgetEnabled?.(data.statusBarWidgetEnabled ?? true);
      } catch (error) {
        console.error('[SettingsView] Failed to parse status bar widget config:', error);
      }
    };

    // Task completion notification config callback (opt-in feature, default false)
    window.updateTaskCompletionNotificationEnabled = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        d().setTaskCompletionNotificationEnabled?.(data.taskCompletionNotificationEnabled ?? false);
      } catch (error) {
        console.error('[SettingsView] Failed to parse task completion notification config:', error);
      }
    };

    // Sound notification config callback
    window.updateSoundNotificationConfig = (jsonStr: string) => {
      try {
        const data = JSON.parse(jsonStr);
        if (data.enabled !== undefined) {
          d().setSoundNotificationEnabled?.(data.enabled);
        }
        if (data.onlyWhenUnfocused !== undefined) {
          d().setSoundOnlyWhenUnfocused?.(data.onlyWhenUnfocused);
        }
        if (data.selectedSound !== undefined) {
          d().setSelectedSound?.(data.selectedSound);
        }
        if (data.customSoundPath !== undefined) {
          d().setCustomSoundPath?.(data.customSoundPath);
        }
      } catch (error) {
        console.error('[SettingsView] Failed to parse sound notification config:', error);
      }
    };

    // Initial data loading
    d().loadProviders();
    sendToJava('get_node_path:');
    sendToJava('get_claude_cli_path:');
    sendToJava('get_working_directory:');
    sendToJava('get_editor_font_config:');
    sendToJava('get_ui_font_config:');
    sendToJava('get_code_font_config:');
    sendToJava('get_streaming_enabled:');
    sendToJava('get_commit_prompt:');
    sendToJava('get_commit_ai_config:');
    sendToJava('get_sound_notification_config:');
    sendToJava('get_commit_generation_enabled:');
    sendToJava('get_ai_title_generation_enabled:');
    sendToJava('get_status_bar_widget_enabled:');
    sendToJava('get_task_completion_notification_enabled:');
    sendToJava('get_permission_dialog_timeout:');

    return () => {
      unsubscribeProviders();
      unsubscribeActiveProvider();
      window.showError = undefined;
      window.showSwitchSuccess = undefined;
      window.updateNodePath = undefined;
      window.updateClaudeCliPath = undefined;
      window.updateWorkingDirectory = undefined;
      window.showSuccess = undefined;
      window.showSuccessI18n = undefined;
      window.onEditorFontConfigReceived = undefined;
      window.onUiFontConfigReceived = undefined;
      window.onCodeFontConfigReceived = undefined;
      window.onIdeThemeReceived = previousOnIdeThemeReceived;
      if (!d().onStreamingEnabledChangeProp) {
        window.updateStreamingEnabled = previousUpdateStreamingEnabled;
      }
      if (!d().onSendShortcutChangeProp) {
        window.updateSendShortcut = previousUpdateSendShortcut;
      }
      window.updateCommitPrompt = undefined;
      window.updateCommitAiConfig = undefined;
      window.updateProjectCommitPrompt = undefined;
      window.updateSoundNotificationConfig = undefined;
      window.updateCommitGenerationEnabled = undefined;
      window.updateAiTitleGenerationEnabled = undefined;
      window.updateStatusBarWidgetEnabled = undefined;
      window.updateTaskCompletionNotificationEnabled = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
}
