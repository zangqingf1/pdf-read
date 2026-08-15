import EditableParagraph from './EditableParagraph';
import type { ParagraphData } from './EditableParagraph';

interface PageGroupProps {
  pageNumber: number | null;
  paragraphs: ParagraphData[];
  dirtySet: Set<number>;
  onParagraphChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
  onHover: (index: number, hovering: boolean) => void;
  onSelect: (index: number) => void;
  highlightedIndex: number | null;
  flash: { index: number; stamp: number } | null;
}

export default function PageGroup({
  pageNumber,
  paragraphs,
  dirtySet,
  onParagraphChange,
  onDelete,
  onMergeDown,
  onHover,
  onSelect,
  highlightedIndex,
  flash,
}: PageGroupProps) {
  const label = pageNumber !== null ? `第 ${pageNumber} 页` : '其他';
  const lastIndex = paragraphs.length - 1;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="flex-1 h-px bg-hairline-soft" />
        <span className="text-xs text-muted-soft flex-shrink-0">
          {label} · {paragraphs.length} 段
        </span>
        <div className="flex-1 h-px bg-hairline-soft" />
      </div>
      {paragraphs.map((para, i) => (
        <EditableParagraph
          key={para.cid}
          paragraph={para}
          isDirty={dirtySet.has(para.index)}
          isLast={i === lastIndex}
          onChange={onParagraphChange}
          onDelete={onDelete}
          onMergeDown={onMergeDown}
          onHover={onHover}
          onSelect={onSelect}
          highlighted={highlightedIndex === para.index}
          flash={flash}
        />
      ))}
    </div>
  );
}
