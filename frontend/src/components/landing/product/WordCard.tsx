const SYN = { word: 'frank', part_of_speech: 'adj.' };
const COGNATE = { word: 'candor', part_of_speech: 'n.' };

interface WordCardProps {
  word: string;
  phonetic: string;
  pos: string;
  definition: string;
  definitionZh: string;
  baseForm?: string;
  examTags?: string[];
}

export default function WordCard({
  word,
  phonetic,
  pos,
  definition,
  definitionZh,
  baseForm,
  examTags = [],
}: WordCardProps) {
  return (
    <div className="rounded-lg border border-reader-line-soft bg-reader-surface p-3.5 shadow-soft">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-reading text-base font-bold text-ink">{word}</span>
          <span className="flex items-center gap-1 text-muted-soft" style={{ fontSize: '0.75em' }}>
            <span className="font-reading">{phonetic}</span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full text-primary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M11 5L6 9H3v6h3l5 4V5zM16.5 12c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 2.1v2.1c3 1 5 4 5 7.8s-2 6.8-5 7.8v2.1c4-1 7-5 7-9.9s-3-8.9-7-9.9z" />
              </svg>
            </span>
          </span>
        </div>
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-soft">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </span>
      </div>

      <div className="mb-2">
        <p className="m-0 font-reading text-body-strong">
          {pos && <span className="mr-1 italic text-muted" style={{ fontSize: '0.85em' }}>{pos}</span>}
          {definition}
        </p>
        <p className="m-0 mt-0.5 font-chinese leading-relaxed text-muted" style={{ fontSize: '0.75em' }}>
          {definitionZh}
        </p>
      </div>

      {baseForm && (
        <div className="mb-2 flex items-center gap-3 text-muted text-[0.75em]">
          <span>原形：<strong className="text-body-strong">{baseForm}</strong></span>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-success text-[0.75em]">同义词</span>
        <span className="inline-flex items-center gap-1 rounded border border-[#c8e6c9] bg-[#f0f7f1] px-2 py-0.5 text-xs">
          {SYN.part_of_speech && <span className="text-muted-soft">{SYN.part_of_speech}</span>}
          <span className="font-medium text-body-strong">{SYN.word}</span>
        </span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-muted text-[0.75em]">同根词</span>
        <span className="inline-flex items-center gap-1 rounded bg-surface-cream-strong px-2 py-0.5 text-xs">
          {COGNATE.part_of_speech && <span className="text-muted-soft">{COGNATE.part_of_speech}</span>}
          <span className="font-medium text-body-strong">{COGNATE.word}</span>
        </span>
      </div>
      {examTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {examTags.map((t) => (
            <span
              key={t}
              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-none ${EXAM_BADGE[t]}`}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const EXAM_BADGE: Record<string, string> = {
  初中: 'bg-[#eef7ee] border-[#bfe0bf] text-[#4a7c59]',
  高中: 'bg-[#eaf3ec] border-[#a9d4b2] text-[#3e6e4c]',
  四级: 'bg-[#eef4fa] border-[#bcd6ee] text-[#4a6d96]',
  六级: 'bg-[#e8eff8] border-[#a5c4e4] text-[#3d5f8a]',
  考研: 'bg-[#fdf1ea] border-[#eecdb5] text-[#b06a3d]',
  雅思: 'bg-[#f2eefa] border-[#d4c6ea] text-[#6f5a9e]',
  托福: 'bg-[#edeafa] border-[#c5bae8] text-[#5f4d94]',
  GRE: 'bg-[#f0ebf5] border-[#cdbedd] text-[#7a5f92]',
};
