import { memo } from 'react';
import EditableParagraph from './EditableParagraph';
import type { ParagraphData } from './EditableParagraph';

interface PageGroupProps {
  pageNumber: number | null;
  paragraphs: ParagraphData[];
  /** 全文最后一段的全局索引（跨页合并判断用，与页组内位置无关） */
  lastGlobalIndex: number;
  dirtySet: Set<number>;
  onParagraphChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
  onSelect: (index: number) => void;
  flash: { index: number; stamp: number } | null;
}

/**
 * memo + 稳定的组数组/回调/dirtySet 引用：击键时只有被编辑段落的
 * PageGroup 重渲染（其中也仅 EditableParagraph 本体更新 DOM）。
 */
const PageGroup = memo(function PageGroup({
  pageNumber,
  paragraphs,
  lastGlobalIndex,
  dirtySet,
  onParagraphChange,
  onDelete,
  onMergeDown,
  onSelect,
  flash,
}: PageGroupProps) {
  const label = pageNumber !== null ? `第 ${pageNumber} 页` : '其他';

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="flex-1 h-px bg-hairline-soft" />
        <span className="text-xs text-muted-soft flex-shrink-0">
          {label} · {paragraphs.length} 段
        </span>
        <div className="flex-1 h-px bg-hairline-soft" />
      </div>
      {paragraphs.map((para) => (
        <EditableParagraph
          key={para.cid}
          paragraph={para}
          isDirty={dirtySet.has(para.index)}
          isLast={para.index === lastGlobalIndex}
          onChange={onParagraphChange}
          onDelete={onDelete}
          onMergeDown={onMergeDown}
          onSelect={onSelect}
          flash={flash}
        />
      ))}
    </div>
  );
});

export default PageGroup;
