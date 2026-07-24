import SortableParagraph from './SortableParagraph';
import type { ParagraphData } from './EditableParagraph';

interface PageGroupProps {
  pageNumber: number | null;
  paragraphs: ParagraphData[];
  dirtySet: Set<number>;
  onParagraphChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
}

export default function PageGroup({
  pageNumber,
  paragraphs,
  dirtySet,
  onParagraphChange,
  onDelete,
  onMergeDown,
}: PageGroupProps) {
  const label = pageNumber !== null ? `第 ${pageNumber} 页` : '其他';
  const lastIndex = paragraphs.length - 1;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-px bg-hairline-soft" />
        <span className="text-sm font-medium text-primary flex-shrink-0">
          {label}
        </span>
        <span className="text-xs text-muted-soft flex-shrink-0">
          {paragraphs.length} 个段落
        </span>
        <div className="flex-1 h-px bg-hairline-soft" />
      </div>
      {paragraphs.map((para, i) => (
        <SortableParagraph
          key={para.cid}
          paragraph={para}
          isDirty={dirtySet.has(para.index)}
          isLast={i === lastIndex}
          onChange={onParagraphChange}
          onDelete={onDelete}
          onMergeDown={onMergeDown}
        />
      ))}
    </div>
  );
}
