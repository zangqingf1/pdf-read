import { useEffect, useCallback, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  closable?: boolean;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = '480px',
  closable = true,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 animate-fade-in"
    >
      <div
        ref={contentRef}
        className="bg-canvas rounded-lg shadow-modal animate-slide-up max-h-[85vh] flex flex-col"
        style={{ width: `min(${width}, calc(100vw - 48px))` }}
      >
        {/* Header */}
        {(title || closable) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-hairline-soft">
            {title && (
              <h3 className="text-lg font-display font-medium text-ink m-0">{title}</h3>
            )}
            {closable && (
              <button
                onClick={onClose}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-ink hover:bg-surface-card transition-colors ml-auto"
                aria-label="关闭"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-hairline-soft">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
