type BadgeVariant = 'default' | 'coral' | 'success' | 'warning';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-surface-card text-ink',
  coral: 'bg-primary text-on-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
};

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center px-2.5 py-0.5 rounded-pill text-xs font-medium',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/** Uppercase coral badge — for "NEW", "BETA" labels */
export function CoralBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-pill text-[11px] font-semibold tracking-widest uppercase bg-primary text-on-primary">
      {children}
    </span>
  );
}
