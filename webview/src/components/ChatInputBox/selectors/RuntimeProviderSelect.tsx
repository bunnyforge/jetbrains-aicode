import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPECIAL_PROVIDER_IDS, type ProviderConfig } from '../../../types/provider';
import { sendBridgeEvent } from '../../../utils/bridge';
import {
  subscribeActiveProvider,
  subscribeProviderList,
} from '../../../utils/runtimeProviderCapabilities';

const DISABLED_OPTION_STYLE: React.CSSProperties = { cursor: 'default' };
const PROVIDER_INFO_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 };
const RELATIVE_INLINE_BLOCK_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };
const CHEVRON_ICON_STYLE: React.CSSProperties = { fontSize: '10px', marginLeft: '2px' };

interface RuntimeProviderSelectProps {
  currentProvider: string;
  embedded?: boolean;
  onClose?: () => void;
  onProviderSwitched?: (providerName: string) => void;
}

const parseProviderList = (json: string): ProviderConfig[] => {
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * RuntimeProviderSelect - lightweight active-provider switcher for the Claude engine.
 */
export const RuntimeProviderSelect = ({ currentProvider, embedded = false, onClose, onProviderSwitched }: RuntimeProviderSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.isActive),
    [providers]
  );

  const getProviderDisplayName = useCallback((provider: ProviderConfig) => {
    if (provider.id === SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS) {
      return t('settings.provider.localProviderName');
    }
    if (provider.id === SPECIAL_PROVIDER_IDS.CLI_LOGIN) {
      return t('settings.provider.cliLoginProviderName');
    }
    if (provider.id === SPECIAL_PROVIDER_IDS.DISABLED) {
      return t('settings.provider.disabled', { defaultValue: 'Disabled' });
    }
    return provider.name || provider.id;
  }, [t]);

  const requestProviders = useCallback(() => {
    setLoading(true);
    sendBridgeEvent('get_providers');
  }, []);

  const handleToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (currentProvider !== 'claude') {
      return;
    }
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      requestProviders();
    }
  }, [currentProvider, isOpen, requestProviders]);

  const handleSelect = useCallback((provider: ProviderConfig) => {
    sendBridgeEvent('switch_provider', JSON.stringify({ id: provider.id }));
    onProviderSwitched?.(getProviderDisplayName(provider));
    setProviders((previous) => previous.map((item) => ({
      ...item,
      isActive: item.id === provider.id,
    })));
    setIsOpen(false);
    onClose?.();
  }, [getProviderDisplayName, onClose, onProviderSwitched]);

  useEffect(() => {
    const unsubscribeProviders = subscribeProviderList((json) => {
      try {
        const next = parseProviderList(json);
        setProviders(next);
        setLoading(false);
      } catch (error) {
        console.error('[RuntimeProviderSelect] Failed to parse Claude providers:', error);
        setLoading(false);
      }
    });

    const unsubscribeActiveProvider = subscribeActiveProvider((json) => {
      try {
        const active = JSON.parse(json) as ProviderConfig;
        if (!active?.id) return;
        setProviders((previous) => previous.map((provider) => ({
          ...provider,
          isActive: provider.id === active.id,
        })));
      } catch (error) {
        console.error('[RuntimeProviderSelect] Failed to parse active Claude provider:', error);
      }
    });

    return () => {
      unsubscribeProviders();
      unsubscribeActiveProvider();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!embedded) return;
    requestProviders();
  }, [embedded, requestProviders]);

  if (currentProvider !== 'claude') {
    return null;
  }

  const activeName = activeProvider ? getProviderDisplayName(activeProvider) : t('config.runtimeProvider.title');

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: embedded ? 0 : '100%',
    left: embedded ? '100%' : 0,
    marginLeft: embedded ? '-30px' : undefined,
    marginBottom: embedded ? undefined : '4px',
    zIndex: 10001,
    minWidth: '260px',
    maxWidth: '360px',
    maxHeight: '300px',
    overflowY: 'auto',
  };

  const renderProviderDropdown = () => (
    <div
      ref={dropdownRef}
      role="listbox"
      className="selector-dropdown runtime-provider-dropdown"
      style={dropdownStyle}
      onMouseEnter={(event) => event.stopPropagation()}
    >
      {loading && providers.length === 0 ? (
        <div className="selector-option disabled" style={DISABLED_OPTION_STYLE}>
          <span className="codicon codicon-loading codicon-modifier-spin" />
          <span>{t('config.runtimeProvider.loading')}</span>
        </div>
      ) : providers.length === 0 ? (
        <div className="selector-option disabled" style={DISABLED_OPTION_STYLE}>
          <span className="codicon codicon-info" />
          <span>{t('config.runtimeProvider.empty')}</span>
        </div>
      ) : (
        providers.map((provider) => {
          const selected = !!provider.isActive;
          const description = provider.remark || provider.websiteUrl;
          return (
            <div
              key={provider.id}
              className={`selector-option ${selected ? 'selected' : ''}`}
              onClick={() => handleSelect(provider)}
              title={description || getProviderDisplayName(provider)}
            >
              <span className="codicon codicon-key" />
              <div style={PROVIDER_INFO_STYLE}>
                <span className="runtime-provider-name">{getProviderDisplayName(provider)}</span>
                {description ? <span className="model-description">{description}</span> : null}
              </div>
              {selected && <span className="codicon codicon-check check-mark" />}
            </div>
          );
        })
      )}
    </div>
  );

  if (embedded) {
    return renderProviderDropdown();
  }

  return (
    <div style={RELATIVE_INLINE_BLOCK_STYLE}>
      <button
        ref={buttonRef}
        type="button"
        className="selector-button runtime-provider-button"
        onClick={handleToggle}
        aria-label={t('config.runtimeProvider.title')}
        title={`${t('config.runtimeProvider.title')}: ${activeName}`}
      >
        <span className="codicon codicon-vm-connect" />
        <span className="selector-button-text runtime-provider-text">{activeName}</span>
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={CHEVRON_ICON_STYLE} />
      </button>

      {isOpen && renderProviderDropdown()}
    </div>
  );
};

export default RuntimeProviderSelect;
