import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSelect } from './ConfigSelect';
import { SPECIAL_PROVIDER_IDS } from '../../../types/provider';

vi.mock('antd', () => ({
  Switch: ({ checked, onClick }: { checked?: boolean; onClick?: (checked: boolean, e: { stopPropagation: () => void }) => void }) => (
    <button type="button" aria-pressed={checked} onClick={() => onClick?.(!checked, { stopPropagation: vi.fn() })} />
  ),
}));

vi.mock('../providers/agentProvider', () => ({
  CREATE_NEW_AGENT_ID: '__create__',
  EMPTY_STATE_ID: '__empty__',
  agentProvider: vi.fn(async () => []),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, string>) => ({
      'settings.configure': 'Configure',
      'settings.agent.title': 'Agent',
      'config.runtimeProvider.title': 'Switch provider',
      'config.runtimeProvider.empty': 'No providers',
      'config.runtimeProvider.loading': 'Loading providers',
      'config.runtimeProvider.switched': 'Provider switched to Proxy A',
      'settings.provider.localProviderName': 'Use local settings.json',
      'settings.provider.cliLoginProviderName': 'Use CLI login',
    } as Record<string, string>)[key] ?? (typeof options === 'string' ? options : key),
  }),
}));

describe('ConfigSelect runtime provider submenu', () => {
  beforeEach(() => {
    window.sendToJava = vi.fn();
    window.updateProviders = undefined;
    window.updateActiveProvider = undefined;
  });

  it('switches Claude runtime providers from the configure menu', async () => {
    render(<ConfigSelect currentProvider="claude" />);

    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    const providerMenuItem = screen.getByText('Switch provider').closest('.selector-option')!;
    expect(providerMenuItem.previousElementSibling).toBeNull();
    fireEvent.mouseEnter(providerMenuItem);

    expect(window.sendToJava).toHaveBeenCalledWith('get_providers:');

    act(() => {
      window.updateProviders?.(JSON.stringify([
        { id: SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS, name: 'hidden local', isActive: true },
        { id: SPECIAL_PROVIDER_IDS.CLI_LOGIN, name: 'hidden cli', isActive: false },
        { id: 'proxy-a', name: 'Proxy A', remark: 'fast route', isActive: false },
      ]));
    });

    const submenu = await screen.findByRole('listbox');
    expect(within(submenu).getByText('Use local settings.json')).toBeTruthy();
    expect(within(submenu).getByText('Use CLI login')).toBeTruthy();
    expect(within(submenu).getByText('Proxy A')).toBeTruthy();

    fireEvent.click(within(submenu).getByText('Proxy A'));

    expect(window.sendToJava).toHaveBeenCalledWith('switch_provider:{"id":"proxy-a"}');
    expect(await screen.findByText('Provider switched to Proxy A')).toBeTruthy();
  });

  it('refreshes selected provider when backend confirms active provider change', async () => {
    render(<ConfigSelect currentProvider="claude" />);

    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    fireEvent.mouseEnter(screen.getByText('Switch provider').closest('.selector-option')!);

    act(() => {
      window.updateProviders?.(JSON.stringify([
        { id: 'a', name: 'Provider A', isActive: true },
        { id: 'b', name: 'Provider B', isActive: false },
      ]));
    });

    const submenu = await screen.findByRole('listbox');

    act(() => {
      window.updateActiveProvider?.(JSON.stringify({ id: 'b', name: 'Provider B', isActive: true }));
    });

    await waitFor(() => {
      expect(within(submenu).getByText('Provider B').closest('.selector-option')?.className).toContain('selected');
    });
  });
});
