import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export default function Card({ children, className = '', hover = false, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={[
        'bg-canvas border border-hairline rounded-lg p-6',
        hover ? 'cursor-pointer transition-shadow duration-200 hover:shadow-card hover:border-hairline-soft' : '',
        onClick ? 'cursor-pointer' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

/** Dark surface card — for code blocks, product showcases */
export function DarkCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-dark rounded-lg p-6 ${className}`}>
      {children}
    </div>
  );
}

/** Card with cream surface-card background */
export function CreamCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-card rounded-lg p-6 ${className}`}>
      {children}
    </div>
  );
}
