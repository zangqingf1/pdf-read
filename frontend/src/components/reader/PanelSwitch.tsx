/**
 * 右侧面板「解析 / AI 问答」紧凑切换控件。
 * 桌面端内嵌在各面板的头部行，移动端放在 StudySheet 顶部拖拽条，不额外占空间。
 */

interface PanelSwitchProps {
  active: 'study' | 'qa';
  onChange: (v: 'study' | 'qa') => void;
}

export default function PanelSwitch({ active, onChange }: PanelSwitchProps) {
  return (
    <div className="flex items-center rounded-lg border border-reader-line-soft bg-reader-surface p-0.5 flex-shrink-0">
      {(['study', 'qa'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          disabled={v === active}
          className={[
            'px-2 py-0.5 text-xs font-medium rounded-md transition-colors',
            v === active
              ? 'bg-primary text-white'
              : 'text-muted hover:text-body-strong',
          ].join(' ')}
        >
          {v === 'study' ? '解析' : 'AI 问答'}
        </button>
      ))}
    </div>
  );
}