import { type ReactNode } from 'react';

interface StudySheetProps {
  children: ReactNode;
  title?: string;
  onClose: () => void;
}

/**
 * Slide-up bottom sheet for mobile study panel.
 * Renders as a full-viewport overlay that slides up from the bottom.
 */
export default function StudySheet({ children, title = '解析面板', onClose }: StudySheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Sheet */}
      <div className="h-[45vh] bg-surface-overlay rounded-t-xl flex flex-col overflow-hidden shadow-elevated animate-sheet-slide-up">
        {/* Drag handle indicator */}
        <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-hairline" />
        </div>



        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}
