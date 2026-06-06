import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { RuntimeProviderSelect } from './RuntimeProviderSelect';

interface ConfigSelectProps {
  currentProvider?: string;
}

const WRAPPER_STYLE: React.CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const TOGGLE_BUTTON_STYLE: React.CSSProperties = {
  marginLeft: '5px',
  marginRight: '-2px',
};

const DROPDOWN_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: '4px',
  zIndex: 10000,
  minWidth: '200px',
};

const SELECTOR_OPTION_RELATIVE_STYLE: React.CSSProperties = { position: 'relative' };

const ITEM_INFO_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const ARROW_CONTAINER_STYLE: React.CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  alignSelf: 'stretch',
  paddingLeft: '12px',
  cursor: 'pointer',
};

const ARROW_ICON_STYLE: React.CSSProperties = { fontSize: '12px' };

const TOAST_STYLE: React.CSSProperties = { zIndex: 20000 };

/**
 * ConfigSelect - Configuration menu (Runtime Provider).
 * Thinking is now controlled by the ReasoningSelect toggle; Streaming /
 * Node Process / Agent entries were removed.
 */
export const ConfigSelect = ({
  currentProvider = 'claude',
}: ConfigSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'none' | 'runtimeProvider'>('none');
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
    if (!isOpen) {
      setActiveSubmenu('none');
    }
  }, [isOpen]);

  const showProviderToast = useCallback((providerName: string) => {
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(t('config.runtimeProvider.switched', { provider: providerName }));
    setShowToast(true);
    toastTimerRef.current = window.setTimeout(() => {
      setShowToast(false);
    }, 1500);
  }, [t]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setActiveSubmenu('none');
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
    return () => {
      if (toastTimerRef.current !== undefined) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return (
    <div style={WRAPPER_STYLE}>
      <button
        ref={buttonRef}
        className="selector-button"
        onClick={handleToggle}
        style={TOGGLE_BUTTON_STYLE}
        title={t('settings.configure', 'Configure')}
      >
        <span className="codicon codicon-settings" />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="selector-dropdown"
          style={DROPDOWN_STYLE}
        >
          {/* Runtime Provider Item */}
          <div
            className="selector-option"
            onMouseEnter={() => setActiveSubmenu('runtimeProvider')}
            onMouseLeave={() => setActiveSubmenu('none')}
            style={SELECTOR_OPTION_RELATIVE_STYLE}
          >
            <span className="codicon codicon-vm-connect" />
            <div style={ITEM_INFO_STYLE}>
              <span>{t('config.runtimeProvider.title')}</span>
            </div>
            <div style={ARROW_CONTAINER_STYLE}>
              <span className="codicon codicon-chevron-right" style={ARROW_ICON_STYLE} />
            </div>

            {activeSubmenu === 'runtimeProvider' && (
              <RuntimeProviderSelect
                currentProvider={currentProvider}
                embedded
                onProviderSwitched={showProviderToast}
                onClose={() => {
                  setIsOpen(false);
                  setActiveSubmenu('none');
                }}
              />
            )}
          </div>
        </div>
      )}

      {showToast && createPortal(
        <div className="selector-toast" style={TOAST_STYLE}>
          {toastMessage}
        </div>,
        document.body
      )}
    </div>
  );
};
