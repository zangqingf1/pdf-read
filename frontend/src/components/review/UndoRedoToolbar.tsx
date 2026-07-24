interface UndoRedoToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function UndoRedoToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: UndoRedoToolbarProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        disabled={!canUndo}
        onClick={onUndo}
        className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-card disabled:opacity-30 transition-colors"
        title="撤销 (Ctrl+Z)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
        </svg>
      </button>
      <button
        disabled={!canRedo}
        onClick={onRedo}
        className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-card disabled:opacity-30 transition-colors"
        title="重做 (Ctrl+Y)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
        </svg>
      </button>
    </div>
  );
}
