import { examTagMeta } from '../../constants/examTags';

interface TagItem {
  word: string;
  part_of_speech?: string;
}

/** 考纲标签徽章组（标签已由调用方按显隐设置过滤） */
export function ExamTagBadges({ tags, className = '' }: { tags: string[]; className?: string }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {tags.map((t) => {
        const meta = examTagMeta(t);
        if (!meta) return null;
        return (
          <span
            key={t}
            className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-none ${meta.className}`}
          >
            {t}
          </span>
        );
      })}
    </div>
  );
}

export function SynonymTags({ items }: { items: TagItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-success text-[0.75em]">同义词</span>
      {items.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 bg-[#f0f7f1] border border-[#c8e6c9] rounded px-2 py-0.5 text-xs"
        >
          {s.part_of_speech && <span className="text-muted-soft">{s.part_of_speech}</span>}
          <span className="font-medium text-body-strong">{s.word}</span>
        </span>
      ))}
    </div>
  );
}

export function CognateTags({ items }: { items: TagItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-muted text-[0.75em]">同根词</span>
      {items.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 bg-surface-cream-strong rounded px-2 py-0.5 text-xs"
        >
          {c.part_of_speech && <span className="text-muted-soft">{c.part_of_speech}</span>}
          <span className="font-medium text-body-strong">{c.word}</span>
        </span>
      ))}
    </div>
  );
}

export function CollocationTags({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-2">
      <span className="text-muted text-[0.75em] block mb-1">常见搭配</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((c, i) => (
          <span
            key={i}
            className="inline-flex items-center bg-[#eef4fa] border border-[#c8ddf0] rounded px-2 py-0.5 text-xs font-reading"
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WordRichTags({
  synonyms,
  cognates,
  collocations,
}: {
  synonyms: TagItem[];
  cognates: TagItem[];
  collocations: string[];
}) {
  const hasSynCogn = (synonyms && synonyms.length > 0) || (cognates && cognates.length > 0);
  return (
    <>
      {/* 同义词 / 同根词：各占一行，标签与词条 chip 同排显示 */}
      {hasSynCogn && (
        <>
          <SynonymTags items={synonyms} />
          <CognateTags items={cognates} />
        </>
      )}
      <CollocationTags items={collocations} />
    </>
  );
}
