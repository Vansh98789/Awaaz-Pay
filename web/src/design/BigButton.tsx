import React from 'react';
import './BigButton.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface BigButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: React.ReactNode;
  loading?: boolean;
  loadingText?: string;
}

export const BigButton = React.forwardRef<HTMLButtonElement, BigButtonProps>(
  (
    {
      variant = 'primary',
      children,
      loading = false,
      loadingText = 'Processing...',
      disabled,
      className = '',
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        className={`big-button variant-${variant} ${loading ? 'is-loading' : ''} ${className}`}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <span className="big-button-loading">
            <span className="loading-dot" aria-hidden="true">●</span>
            <span>{loadingText}</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

BigButton.displayName = 'BigButton';
