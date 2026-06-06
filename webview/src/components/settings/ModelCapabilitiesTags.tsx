import { useTranslation } from 'react-i18next';
import type { ModelCapabilities } from '../../services/openRouterCatalog';

const TAGS_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
  marginTop: '2px',
  alignItems: 'center',
};

const PILL_BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  padding: '1px 6px',
  borderRadius: '8px',
  fontSize: '10px',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

const PILL_PRESENT_STYLE: React.CSSProperties = {
  ...PILL_BASE_STYLE,
  background: 'var(--badge-info-bg, rgba(56, 139, 253, 0.15))',
  color: 'var(--badge-info-fg, #389bfd)',
};

const PILL_ABSENT_STYLE: React.CSSProperties = {
  ...PILL_BASE_STYLE,
  background: 'var(--bg-tertiary, rgba(127, 127, 127, 0.1))',
  color: 'var(--text-tertiary)',
  opacity: 0.6,
};

function formatContextWindow(value: number): string {
  if (!value || value <= 0) return '—';
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function CapabilityPill({
  label,
  present,
  icon,
}: {
  label: string;
  present: boolean;
  icon: string;
}) {
  const style = present ? PILL_PRESENT_STYLE : PILL_ABSENT_STYLE;
  return (
    <span style={style} title={label} aria-label={label}>
      <span className={`codicon ${icon}`} style={{ fontSize: '9px' }} />
      {label}
    </span>
  );
}

export interface ModelCapabilitiesTagsProps {
  capabilities: ModelCapabilities | null | undefined;
  /** Show "absent" pills (greyed). When false, only present pills are shown. */
  showAbsent?: boolean;
  /** Show a leading context-window pill (e.g. "200K"). Defaults to true. */
  showContext?: boolean;
  /** Show the tools pill. Defaults to true. */
  showTools?: boolean;
  /** Show the image-input pill. Defaults to true. */
  showImage?: boolean;
  /** Show the file-input pill (non-image files via inputModalities.includes('file')). */
  showFile?: boolean;
  /** Compact mode — hides the icons and uses even smaller padding. */
  compact?: boolean;
}

/**
 * Small horizontal row of pills summarizing a model's capabilities
 * (context window, tools, image input, file input). Used in:
 *  - `ModelSelect` dropdown rows (chat input)
 *  - `CustomModelDialog` list rows (settings)
 *  - `ProviderDialog` sonnet/opus/haiku field hints
 *
 * The component is presentation-only — callers are responsible for
 * resolving the actual `ModelCapabilities` (from `useModelCapabilities` or
 * a stored override) and passing it in.
 */
export function ModelCapabilitiesTags({
  capabilities,
  showAbsent = false,
  showContext = true,
  showTools = true,
  showImage = true,
  showFile = false,
  compact = false,
}: ModelCapabilitiesTagsProps) {
  const { t } = useTranslation();

  if (!capabilities) return null;

  const pills: React.ReactNode[] = [];

  if (showContext && capabilities.contextWindow > 0) {
    pills.push(
      <span
        key="ctx"
        style={{
          ...PILL_BASE_STYLE,
          background: 'var(--vscode-badge-background)',
          color: 'var(--vscode-badge-foreground)',
          fontVariantNumeric: 'tabular-nums',
        }}
        title={t('pluginModels.tags.context', {
          defaultValue: 'Context window',
        })}
      >
        {formatContextWindow(capabilities.contextWindow)}
      </span>
    );
  }

  if (showTools) {
    if (capabilities.supportsToolUse || showAbsent) {
      pills.push(
        <CapabilityPill
          key="tools"
          label={t('pluginModels.tags.tools', { defaultValue: 'tools' })}
          present={capabilities.supportsToolUse}
          icon={capabilities.supportsToolUse ? 'codicon-tools' : 'codicon-tools'}
        />
      );
    }
  }

  if (showImage) {
    if (capabilities.supportsImageInput || showAbsent) {
      pills.push(
        <CapabilityPill
          key="image"
          label={t('pluginModels.tags.image', { defaultValue: 'image' })}
          present={capabilities.supportsImageInput}
          icon={capabilities.supportsImageInput ? 'codicon-file-media' : 'codicon-circle-outline'}
        />
      );
    }
  }

  if (showFile) {
    const supportsFile = capabilities.inputModalities?.includes('file') ?? false;
    if (supportsFile || showAbsent) {
      pills.push(
        <CapabilityPill
          key="file"
          label={t('pluginModels.tags.file', { defaultValue: 'file' })}
          present={supportsFile}
          icon={supportsFile ? 'codicon-paperclip' : 'codicon-circle-outline'}
        />
      );
    }
  }

  if (pills.length === 0) return null;

  return (
    <div
      style={{
        ...TAGS_ROW_STYLE,
        ...(compact
          ? { gap: '3px', marginTop: 0, fontSize: '9px' }
          : null),
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
      data-testid="model-capability-tags"
    >
      {pills}
    </div>
  );
}

export default ModelCapabilitiesTags;
