import React from 'react';
import './StatusBanner.css';

export type BannerVariant = 'success' | 'warning' | 'danger';

interface StatusBannerProps {
  variant: BannerVariant;
  label?: string; // Word label (e.g. "Success", "Warning", "Blocked")
  children: React.ReactNode;
  className?: string;
  lang?: string;
}

export const StatusBanner: React.FC<StatusBannerProps> = ({
  variant,
  label,
  children,
  className = '',
  lang,
}) => {
  const defaultLabel =
    variant === 'success' ? 'Success' : variant === 'warning' ? 'Warning' : 'Blocked';
  const displayLabel = label || defaultLabel;

  // Accessible role: danger / alert requires role="alert", others role="status"
  const role = variant === 'danger' ? 'alert' : 'status';

  return (
    <div
      role={role}
      lang={lang}
      className={`status-banner banner-${variant} ${className}`}
      aria-live={variant === 'danger' ? 'assertive' : 'polite'}
    >
      <div className="banner-prefix">
        <span className="banner-dots" aria-hidden="true">
          {variant === 'success' && '● ● ●'}
          {variant === 'warning' && '▲ ● ▲'}
          {variant === 'danger' && '■ ■ ■'}
        </span>
        <strong className="banner-word-label">{displayLabel}:</strong>
      </div>
      <div className="banner-content">{children}</div>
    </div>
  );
};
