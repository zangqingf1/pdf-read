interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export default function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <svg
        className={`animate-spin ${sizeMap[size]} text-primary`}
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {label && <p className="text-sm text-muted">{label}</p>}
    </div>
  );
}

/** Full-page loading state */
export function PageSpinner({ label = '加载中...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-canvas">
      <Spinner size="lg" label={label} />
    </div>
  );
}
