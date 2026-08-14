import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export default function Input({
  label,
  error,
  hint,
  className = '',
  id,
  ...props
}: InputProps) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-body-strong">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[
          'w-full h-10 px-3.5 py-2.5 rounded-md border text-sm font-sans text-ink bg-canvas',
          'placeholder:text-muted-soft',
          'transition-colors duration-150',
          'focus:outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]',
          error ? 'border-error shadow-[0_0_0_3px_rgba(198,69,69,0.10)]' : 'border-hairline hover:border-muted-soft',
          className,
        ].join(' ')}
        {...props}
      />
      {error && <p className="text-xs text-error">{error}</p>}
      {hint && !error && <p className="text-xs text-muted-soft">{hint}</p>}
    </div>
  );
}

// ── TextArea ──
interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ label, error, className = '', id, ...props }, ref) {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-body-strong">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={[
            'w-full min-h-[120px] px-3.5 py-2.5 rounded-md border text-sm font-sans text-ink bg-canvas resize-y',
            'placeholder:text-muted-soft',
            'transition-colors duration-150',
            'focus:outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]',
            error ? 'border-error shadow-[0_0_0_3px_rgba(198,69,69,0.10)]' : 'border-hairline hover:border-muted-soft',
            className,
          ].join(' ')}
          {...props}
        />
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
    );
  }
);
