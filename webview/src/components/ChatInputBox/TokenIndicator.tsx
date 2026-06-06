import { useTranslation } from 'react-i18next';
import type { TokenIndicatorProps } from './types';

/**
 * TokenIndicator - Usage ring progress bar component
 * Implemented using SVG dual-circle approach
 */
export const TokenIndicator = ({
  percentage,
  size = 14,
  usedTokens,
  maxTokens,
}: TokenIndicatorProps) => {
  const { t } = useTranslation();
  // Circle radius (accounting for stroke space)
  const radius = (size - 3) / 2;
  const center = size / 2;

  // Circumference
  const circumference = 2 * Math.PI * radius;

  // Clamp the ring fill to [0, 100] so it stays a valid SVG arc even when
  // the backend reports overflow (>100%). The label and tooltip show the
  // unclamped value so overflow is still visible to the user.
  const ringPercentage = Math.max(0, Math.min(100, percentage));
  const strokeOffset = circumference * (1 - ringPercentage / 100);

  // Indicator label: integer percentage (no decimal) — show the real value,
  // not the clamped one, so an overflow reads as e.g. "105%".
  const labelPercentage = `${Math.round(percentage)}%`;
  // Tooltip: one decimal place for precision (also unclamped).
  const tooltipPercentage = `${(Math.round(percentage * 10) / 10).toFixed(1)}%`;

  const formatTokens = (value?: number) => {
    if (typeof value !== 'number' || !isFinite(value)) return undefined;
    // Always display capacity in k (thousands) units
    // e.g.: 1,000,000 -> 1000k, 500,000 -> 500k
    if (value >= 1_000) {
      const kValue = value / 1_000;
      // If it's a whole number, don't show decimal point
      return Number.isInteger(kValue) ? `${kValue}k` : `${kValue.toFixed(1)}k`;
    }
    return `${value}`;
  };

  const usedText = formatTokens(usedTokens);
  const maxText = formatTokens(maxTokens);
  const tooltip = usedText && maxText
    ? `${tooltipPercentage} · ${usedText} / ${maxText} ${' '}${t('chat.context')}`
    : t('chat.usagePercentage', { percentage: tooltipPercentage });

  return (
    <div className="token-indicator">
      <div className="token-indicator-wrap">
        <svg
          className="token-indicator-ring"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Background circle */}
          <circle
            className="token-indicator-bg"
            cx={center}
            cy={center}
            r={radius}
          />
          {/* Progress arc */}
          <circle
            className="token-indicator-fill"
            cx={center}
            cy={center}
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
          />
        </svg>
        {/* Hover tooltip */}
        <div className="token-tooltip">
          {tooltip}
        </div>
      </div>
      <span className="token-percentage-label">{labelPercentage}</span>
    </div>
  );
};

export default TokenIndicator;
