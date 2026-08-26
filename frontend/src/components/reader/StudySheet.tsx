import { useEffect, useState, type ReactNode } from 'react';

interface StudySheetProps {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
}

const CLOSE_ANIM_MS = 300;

/**
 * Slide-up bottom sheet for mobile study panel.
 * Renders as a full-viewport overlay that slides up from the bottom.
 * Keeps itself mounted through the closing animation before unmounting.
 */
export default function StudySheet({ children, onClose, open }: StudySheetProps) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
    } else if (rendered) {
      setClosing(true);
      const t = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, CLOSE_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [open, rendered]);

  if (!rendered) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div
        className={`flex-1 bg-black/30 transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}
        onClick={onClose}
      />

      {/* Sheet */}
      <div className={`h-[45vh] bg-reader-surface rounded-t-xl flex flex-col overflow-hidden shadow-elevated ${closing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}>
        {/* Drag handle indicator */}
        <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-[color-mix(in_srgb,var(--ink)_18%,transparent)]" />
        </div>



        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}
