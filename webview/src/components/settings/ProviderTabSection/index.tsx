import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderConfig } from '../../../types/provider';
import { STORAGE_KEYS } from '../../../types/provider';
import ProviderManageSection from '../ProviderManageSection';
import CustomModelDialog from '../CustomModelDialog';
import { usePluginModels } from '../hooks/usePluginModels';
import styles from './style.module.less';

interface ProviderTabSectionProps {
  currentProvider: 'claude' | string;
  providers: ProviderConfig[];
  loading: boolean;
  onAddProvider: () => void;
  onEditProvider: (provider: ProviderConfig) => void;
  onDeleteProvider: (provider: ProviderConfig) => void;
  onSwitchProvider: (id: string) => void;
  addToast: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

const ICON_14_STYLE: React.CSSProperties = { fontSize: 14 };
const FLEX_1_STYLE: React.CSSProperties = { flex: 1 };

const ProviderTabSection = ({
  providers,
  loading,
  onAddProvider,
  onEditProvider,
  onDeleteProvider,
  onSwitchProvider,
  addToast,
}: ProviderTabSectionProps) => {
  const { t } = useTranslation();

  const claudeModels = usePluginModels(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);

  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelDialogAddMode, setModelDialogAddMode] = useState(false);

  const openModelDialog = useCallback((addMode = false) => {
    setModelDialogAddMode(addMode);
    setModelDialogOpen(true);
  }, []);

  const closeModelDialog = useCallback(() => {
    setModelDialogOpen(false);
    setModelDialogAddMode(false);
  }, []);

  return (
    <div className={styles.providerTabSection}>
      <h3 className={styles.sectionTitle}>{t('settings.providers')}</h3>
      <p className={styles.sectionDesc}>{t('settings.providersDesc')}</p>

      <div
        className={styles.pluginModelsRow}
        onClick={() => openModelDialog(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openModelDialog(false); }}
      >
        <span className="codicon codicon-symbol-misc" style={ICON_14_STYLE} />
        <span className={styles.pluginModelsLabel}>
          {t('settings.pluginModels.title')}
        </span>
        {claudeModels.models.length > 0 && (
          <span className={styles.pluginModelsBadge}>{claudeModels.models.length}</span>
        )}
        <span style={FLEX_1_STYLE} />
        <button
          className={styles.pluginModelsManageBtn}
          onClick={(e) => { e.stopPropagation(); openModelDialog(false); }}
        >
          {t('settings.pluginModels.manage')}
        </button>
      </div>

      <ProviderManageSection
        providers={providers}
        loading={loading}
        onAddProvider={onAddProvider}
        onEditProvider={onEditProvider}
        onDeleteProvider={onDeleteProvider}
        onSwitchProvider={onSwitchProvider}
        addToast={addToast}
        showHeader={false}
      />

      <CustomModelDialog
        isOpen={modelDialogOpen}
        models={claudeModels.models}
        onModelsChange={claudeModels.updateModels}
        onClose={closeModelDialog}
        initialAddMode={modelDialogAddMode}
      />
    </div>
  );
};

export default ProviderTabSection;
