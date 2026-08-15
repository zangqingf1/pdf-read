import { useMemo } from 'react';
import PageGroup from './PageGroup';
import type { ParagraphData } from './EditableParagraph';

interface EditableParagraphPanelProps {
  paragraphs: ParagraphData[];
  dirtySet: Set<number>;
  onParagraphChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
  onHover: (index: number, hovering: boolean) => void;
  /** 点击段落 → 定位到 PDF 预览中对应解析框 */
  onSelect: (index: number) => void;
  /** 联动高亮：悬浮 PDF 解析框时高亮对应段落 */
  highlightedIndex: number | null;
  /** 点击解析框后段落闪烁高亮 */
  flash: { index: number; stamp: number } | null;
}

export default function EditableParagraphPanel({
  paragraphs,
  dirtySet,
  onParagraphChange,
  onDelete,
  onMergeDown,
  onHover,
  onSelect,
  highlightedIndex,
  flash,
}: EditableParagraphPanelProps) {
  const pageGroups = useMemo(() => {
    const groups: Map<number | null, ParagraphData[]> = new Map();

    for (const para of paragraphs) {
      const key = para.page_number ?? null;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(para);
    }

    const entries = Array.from(groups.entries());
    entries.sort(([a], [b]) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });

    return entries;
  }, [paragraphs]);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      {pageGroups.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm">
          暂无段落数据
        </div>
      ) : (
        pageGroups.map(([pageNumber, paras]) => (
          <PageGroup
            key={pageNumber ?? '__other__'}
            pageNumber={pageNumber}
            paragraphs={paras}
            dirtySet={dirtySet}
            onParagraphChange={onParagraphChange}
            onDelete={onDelete}
            onMergeDown={onMergeDown}
            onHover={onHover}
            onSelect={onSelect}
            highlightedIndex={highlightedIndex}
            flash={flash}
          />
        ))
      )}
    </div>
  );
}
