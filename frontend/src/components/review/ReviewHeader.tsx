import Button from '../ui/Button';
import UndoRedoToolbar from './UndoRedoToolbar';

interface ReviewHeaderProps {
  title: string;
  hasUnsaved: boolean;
  saving: boolean;
  onSave: () => void;
  onStartReading: () => void;
  onBack: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function ReviewHeader({
  title,
  hasUnsaved,
  saving,
  onSave,
  onStartReading,
  onBack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ReviewHeaderProps) {
  return (
    <div className="flex items-center justify-between h-[52px] px-3 md:px-5 border-b border-hairline bg-canvas flex-shrink-0">
      {/* Left: back button + title */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
        <button
          onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-card transition-colors touch-area flex-shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-base font-display font-medium text-ink max-w-[100px] md:max-w-[400px] truncate m-0">
          {title || '未命名文档'}
        </h3>
        {hasUnsaved && (
          <span className="flex items-center gap-1.5 text-xs text-warning flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
            <span className="hidden sm:inline">有未保存的修改</span>
          </span>
        )}
      </div>

      {/* Right: undo/redo + actions */}
      <div className="flex items-center gap-1.5 md:gap-3 flex-shrink-0">
        <div className="hidden sm:block">
          <UndoRedoToolbar
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        </div>
        <div className="w-px h-6 bg-hairline hidden sm:block" />
        <Button
          variant={hasUnsaved ? 'primary' : 'secondary'}
          size="sm"
          loading={saving}
          disabled={!hasUnsaved && !saving}
          onClick={onSave}
        >
          <span className="hidden sm:inline">保存修改</span>
          <span className="sm:hidden">保存</span>
        </Button>
        <Button
          variant={hasUnsaved ? 'secondary' : 'primary'}
          size="sm"
          onClick={onStartReading}
        >
          <span className="hidden sm:inline">开始阅读</span>
          <span className="sm:hidden">阅读</span>
        </Button>
      </div>
    </div>
  );
}
