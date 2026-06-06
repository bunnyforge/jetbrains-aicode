import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import AiFeatureProviderModelPanel from './index';
import { CLAUDE_MODELS } from '../../ChatInputBox/types';
import { STORAGE_KEYS } from '../../../types/provider';
import type { CommitAiConfig } from '../../../types/aiFeatureConfig';

const panelStyles = readFileSync(
  'src/components/settings/AiFeatureProviderModelPanel/style.module.less',
  'utf8'
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => options?.provider
      ? `${key}:${options.provider}`
      : key,
  }),
}));

describe('AiFeatureProviderModelPanel', () => {
  const config: CommitAiConfig = {
    provider: null,
    effectiveProvider: 'claude',
    resolutionSource: 'auto',
    models: {
      claude: 'claude-sonnet-4-6',
    },
    availability: {
      claude: true,
    },
  };

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
    localStorage.removeItem(STORAGE_KEYS.CLAUDE_MODEL_MAPPING);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
    localStorage.removeItem(STORAGE_KEYS.CLAUDE_MODEL_MAPPING);
  });

  it('renders provider select, model select, status hint, and reset button', () => {
    render(
      <AiFeatureProviderModelPanel
        config={config}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    expect(screen.getByText('settings.commit.providerModel.currentProviderAuto:settings.basic.promptEnhancer.provider.claude')).toBeTruthy();
    expect(screen.getByTestId('provider-select-icon')).toBeTruthy();
    expect(screen.getByTestId('ai-feature-actions-row')).toBeTruthy();
    expect(screen.getByTestId('ai-feature-status-hint')).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'settings.commit.providerModel.resetToDefault' })).toBeTruthy();
  });

  it('keeps both rows compact with ellipsis instead of wrapping', () => {
    expect(panelStyles).toMatch(
      /\.selectGroup\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(0,\s*0\.85fr\);/
    );
    expect(panelStyles).toMatch(
      /\.providerSelect,\s*\.modelSelect\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/
    );
    expect(panelStyles).toMatch(
      /\.actionsRow\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*gap:\s*12px;/
    );
    expect(panelStyles).toMatch(
      /\.statusText\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/
    );
  });

  it('lists built-in Claude models in the model selector', () => {
    render(
      <AiFeatureProviderModelPanel
        config={config}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    const [, modelSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const optionValues = Array.from(modelSelect.options).map((o) => o.value);
    for (const model of CLAUDE_MODELS) {
      expect(optionValues).toContain(model.id);
    }
  });

  it('invokes the reset callback', () => {
    const onResetToDefault = vi.fn();

    render(
      <AiFeatureProviderModelPanel
        config={{
          ...config,
          provider: 'claude',
          effectiveProvider: 'claude',
          resolutionSource: 'manual',
        }}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={onResetToDefault}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'settings.commit.providerModel.resetToDefault' }));

    expect(onResetToDefault).toHaveBeenCalledTimes(1);
  });

  it('calls model change callback when a model is selected', () => {
    const onModelChange = vi.fn();
    const targetModel = CLAUDE_MODELS[2].id;

    render(
      <AiFeatureProviderModelPanel
        config={config}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={onModelChange}
        onResetToDefault={vi.fn()}
      />
    );

    const [, modelSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(modelSelect, { target: { value: targetModel } });

    expect(onModelChange).toHaveBeenCalledWith(targetModel);
  });

  it('includes user-defined custom models in the selector and lists them before built-ins', () => {
    const customId = 'deepseek/deepseek-v4-flash';
    localStorage.setItem(
      STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([{ id: customId, label: customId, description: 'Custom' }])
    );

    render(
      <AiFeatureProviderModelPanel
        config={config}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    const [, modelSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const optionValues = Array.from(modelSelect.options).map((o) => o.value);
    expect(optionValues[0]).toBe(customId);
    expect(optionValues).toContain(CLAUDE_MODELS[0].id);
  });

  it('applies model mapping to every built-in Claude model including opus-4-6', () => {
    const mappedLabel = 'deepseek/deepseek-v4-flash';
    // Same shape as useProviderSettings.syncActiveProviderModelMapping:
    // main/sonnet/opus/haiku read from ANTHROPIC_* env vars.
    localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({
        main: '',
        sonnet: mappedLabel,
        opus: mappedLabel,
        haiku: mappedLabel,
      })
    );

    render(
      <AiFeatureProviderModelPanel
        config={config}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    const [, modelSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const optionLabels = Array.from(modelSelect.options).map((o) => o.text);
    // All built-in models should be remapped to the custom label, including opus-4-6.
    for (const model of CLAUDE_MODELS) {
      expect(optionLabels).toContain(mappedLabel);
    }
    // The original "Opus 4.6" label must NOT appear (it was the bug).
    expect(optionLabels).not.toContain('Opus 4.6');
  });
});
