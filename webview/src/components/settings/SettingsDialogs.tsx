// SettingsDialogs.tsx
import { useTranslation } from 'react-i18next';
import type { ProviderConfig } from '../../types/provider';
import AlertDialog from '../AlertDialog';
import type { AlertType } from '../AlertDialog';
import ConfirmDialog from '../ConfirmDialog';
import ProviderDialog from '../ProviderDialog';
import type { ToastMessage } from '../Toast';
import type { ProviderDialogState, DeleteConfirmState } from './hooks/useProviderManagement';

interface SettingsDialogsProps {
  alertDialog: { isOpen: boolean; type: AlertType; title: string; message: string };
  onCloseAlert: () => void;

  providerDialog: ProviderDialogState;
  deleteConfirm: DeleteConfirmState;
  onCloseProviderDialog: () => void;
  onSaveProvider: (data: { providerName: string; remark: string; apiKey: string; apiUrl: string; jsonConfig: string }) => void;
  onDeleteProvider: (provider: ProviderConfig) => void;
  onConfirmDeleteProvider: () => void;
  onCancelDeleteProvider: () => void;

  addToast: (message: string, type?: ToastMessage['type']) => void;
}

const SettingsDialogs = ({
  alertDialog,
  onCloseAlert,
  providerDialog,
  deleteConfirm,
  onCloseProviderDialog,
  onSaveProvider,
  onDeleteProvider,
  onConfirmDeleteProvider,
  onCancelDeleteProvider,
  addToast,
}: SettingsDialogsProps) => {
  const { t } = useTranslation();

  return (
    <>
      <AlertDialog
        isOpen={alertDialog.isOpen}
        type={alertDialog.type}
        title={alertDialog.title}
        message={alertDialog.message}
        onClose={onCloseAlert}
      />

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title={t('settings.provider.deleteConfirm')}
        message={t('settings.provider.deleteProviderMessage', { name: deleteConfirm.provider?.name || '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={onConfirmDeleteProvider}
        onCancel={onCancelDeleteProvider}
      />

      <ProviderDialog
        isOpen={providerDialog.isOpen}
        provider={providerDialog.provider}
        onClose={onCloseProviderDialog}
        onSave={onSaveProvider}
        onDelete={onDeleteProvider}
        canDelete={true}
        addToast={addToast}
      />
    </>
  );
};

export default SettingsDialogs;
