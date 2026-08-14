import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'text';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-active active:bg-primary-active border-transparent shadow-soft',
  secondary:
    'bg-canvas text-ink border-hairline hover:border-primary/60 hover:bg-canvas-soft active:bg-surface-card shadow-soft',
  ghost:
    'bg-transparent text-ink border-transparent hover:bg-surface-card/80 active:bg-surface-cream-strong',
  danger:
    'bg-error text-white hover:opacity-90 active:opacity-80 border-transparent shadow-soft',
  text: 'bg-transparent text-muted border-transparent hover:text-ink hover:bg-surface-card active:bg-surface-cream-strong',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs h-8',
  md: 'px-5 py-2.5 text-sm h-10',
  lg: 'px-6 py-3 text-base h-12',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-2 font-medium rounded-md border transition-all duration-150 select-none active:scale-[0.98]',
        'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:active:scale-100',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon ? (
        <span className="inline-flex">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
