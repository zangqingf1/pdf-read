import { useRef } from 'react';
import PageGroup from './PageGroup';
import type { ParagraphData } from './EditableParagraph';

interface EditableParagraphPanelProps {
  paragraphs: ParagraphData[];
  dirtySet: Set<number>;
  onParagraphChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
  /** 点击段落 → 定位到 PDF 预览中对应解析框 */
  onSelect: (index: number) => void;
  /** 点击解析框后段落闪烁高亮 */
  flash: { index: number; stamp: number } | null;
}

/** 按页码分组；返回 [pageNumber, ParagraphData[]][]（null 页码排最后） */
function buildPageGroups(paragraphs: ParagraphData[]): [number | null, ParagraphData[]][] {
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
}

export default function EditableParagraphPanel({
  paragraphs,
  dirtySet,
  onParagraphChange,
  onDelete,
  onMergeDown,
  onSelect,
  flash,
}: EditableParagraphPanelProps) {
  // 击键只替换被编辑段落的对象引用 —— 用引用级比较做分组缓存：
  // 段落对象一个没变时直接复用上次分组（数组引用稳定 → PageGroup memo 生效），
  // 避免每次击键重建全部分组数组、触发所有 PageGroup 重渲染。
  const prevParasRef = useRef<ParagraphData[] | null>(null);
  const pageGroupsRef = useRef<[number | null, ParagraphData[]][] | null>(null);

  if (paragraphs !== prevParasRef.current) {
    const prev = prevParasRef.current;
    const sameRefs =
      prev !== null &&
      prev.length === paragraphs.length &&
      paragraphs.every((p, i) => p === prev[i]);
    if (!sameRefs) {
      pageGroupsRef.current = buildPageGroups(paragraphs);
    }
    prevParasRef.current = paragraphs;
  }

  // 渲染期 ref 缓存（非 Hook）：引用级比较后直接读缓存数组
  const pageGroups = pageGroupsRef.current ?? [];

  // 全文最后一段的索引：跨页合并时，某页的最后一段也要显示「合并」按钮
  //（合并的是 index 与 index+1，与页码无关；不能按页组内最后一段判断）
  const lastGlobalIndex = paragraphs.reduce(
    (max, p) => (p.index > max ? p.index : max),
    -1
  );

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
            lastGlobalIndex={lastGlobalIndex}
            dirtySet={dirtySet}
            onParagraphChange={onParagraphChange}
            onDelete={onDelete}
            onMergeDown={onMergeDown}
            onSelect={onSelect}
            flash={flash}
          />
        ))
      )}
    </div>
  );
}
