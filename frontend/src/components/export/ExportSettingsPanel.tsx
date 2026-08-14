/**
 * 导出设置面板：modal 右侧 360px。
 * 纸张/风格/分栏比例/字号（二级折叠面板，每组独立步进）/内容选择。
 */
import { useState, type ReactNode } from 'react';
import { useExportPreferences, type ToggleKey } from '../../stores/exportPreferencesStore';
import { PAPER_SIZE_KEYS, PAPER_SIZES } from '../../export/exportTypes';
import { THEMES } from '../../export/themes';
import type { FontSizeDef } from '../../export/exportTypes';

type FontSizeKey = 'fontSizeText' | 'fontSizeTranslation' | 'fontSizeSummary' | 'fontSizeWord' | 'fontSizeSentence';
type FontSizeSetter = 'setFontSizeText' | 'setFontSizeTranslation' | 'setFontSizeSummary' | 'setFontSizeWord' | 'setFontSizeSentence';

const FONT_SIZE_ROWS: { key: FontSizeKey; setter: FontSizeSetter; label: string; def: FontSizeDef }[] = [
  { key: 'fontSizeText', setter: 'setFontSizeText', label: '原文', def: { min: 12, max: 20, step: 0.5 } },
  { key: 'fontSizeTranslation', setter: 'setFontSizeTranslation', label: '译文', def: { min: 11, max: 19, step: 0.5 } },
  { key: 'fontSizeSummary', setter: 'setFontSizeSummary', label: '全文总结', def: { min: 12, max: 20, step: 0.5 } },
  { key: 'fontSizeWord', setter: 'setFontSizeWord', label: '单词解析', def: { min: 10, max: 18, step: 0.5 } },
  { key: 'fontSizeSentence', setter: 'setFontSizeSentence', label: '句子解析', def: { min: 10, max: 18, step: 0.5 } },
];

const MAIN_TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: 'includeSummary', label: '全文总结' },
  { key: 'includeTranslation', label: '段落翻译' },
  { key: 'includeWords', label: '单词解析' },
  { key: 'includeSentences', label: '句子解析' },
];

const WORD_DETAIL_TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: 'includePhonetic', label: '音标' },
  { key: 'includeChineseDefinition', label: '中文释义' },
  { key: 'includeBaseForm', label: '原形' },
  { key: 'includeSynonyms', label: '同义词' },
  { key: 'includeCognates', label: '同根词' },
];

const SENTENCE_DETAIL_TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: 'includeReadingCues', label: '阅读线索' },
  { key: 'includeIdiomaticTranslation', label: '地道翻译' },
];

/** 折叠区块（字号二级菜单） */
function AccordionSection({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-hairline rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-body-strong hover:bg-surface-card transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge && (
            <span className="text-[11px] text-muted-soft font-normal">{badge}</span>
          )}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** 字号步进行：[标签] [−] [11.5px] [+] */
function FontSizeRow({
  label,
  value,
  def,
  onChange,
}: {
  label: string;
  value: number;
  def: FontSizeDef;
  onChange: (v: number) => void;
}) {
  const step = def.step;
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-body">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(Math.max(def.min, Math.round((value - step) * 2) / 2))}
          disabled={value <= def.min}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-hairline text-body hover:bg-surface-card disabled:opacity-30 transition-colors"
          aria-label={`减小${label}字号`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
        </button>
        <span className="text-sm text-ink tabular-nums min-w-[48px] text-center">{value}px</span>
        <button
          onClick={() => onChange(Math.min(def.max, Math.round((value + step) * 2) / 2))}
          disabled={value >= def.max}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-hairline text-body hover:bg-surface-card disabled:opacity-30 transition-colors"
          aria-label={`增大${label}字号`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    </div>
  );
}

/** 开关行（可选 hint 副文案） */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer select-none">
      <span className="flex flex-col">
        <span className="text-sm text-body">{label}</span>
        {hint && <span className="text-[11px] text-muted-soft">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer"
      />
    </label>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-2.5">{children}</h4>;
}

export default function ExportSettingsPanel() {
  const store = useExportPreferences();
  const {
    paperSize, theme, leftWidthRatio,
    setPaperSize, setTheme, setLeftWidthRatio,
    toggle, resetAll,
  } = store;

  const ratioPct = Math.round(leftWidthRatio * 100);
  const mainOn = MAIN_TOGGLES.filter((t) => store[t.key]).length;
  const wordOn = WORD_DETAIL_TOGGLES.filter((t) => store[t.key]).length;
  const sentenceOn = SENTENCE_DETAIL_TOGGLES.filter((t) => store[t.key]).length;

  return (
    <div className="w-full md:w-[360px] shrink-0 border-t md:border-t-0 md:border-l border-hairline bg-canvas overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* ── 纸张与版式 ── */}
        <section>
          <SectionTitle>纸张大小</SectionTitle>
          <div className="flex gap-1.5">
            {PAPER_SIZE_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setPaperSize(key)}
                className={`flex-1 px-2 py-2 rounded-md text-sm border transition-all duration-150 ${
                  paperSize === key
                    ? 'border-primary bg-surface-card text-primary font-medium'
                    : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                }`}
              >
                {PAPER_SIZES[key].label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>风格</SectionTitle>
          <div className="grid grid-cols-3 gap-1.5">
            {THEMES.map((t) => (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                title={t.desc}
                className={`flex flex-col items-center gap-1.5 px-1.5 py-2.5 rounded-lg border transition-all duration-150 ${
                  theme === t.key
                    ? 'border-primary bg-surface-card'
                    : 'border-hairline hover:border-muted-soft hover:bg-canvas-soft'
                }`}
              >
                <span className="flex -space-x-1">
                  {t.swatches.map((c, i) => (
                    <span
                      key={i}
                      className="w-5 h-5 rounded-full border border-hairline"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="text-xs text-body-strong">{t.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── 来源（历史可选） ── */}
        <section>
          <SectionTitle>来源</SectionTitle>
          <input
            type="text"
            list="export-source-options"
            value={store.source}
            onChange={(e) => store.setSource(e.target.value)}
            onBlur={() => store.commitSourceHistory()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                store.commitSourceHistory();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="如 The Economist / Nature，留空则不显示"
            className="w-full px-3 py-2 rounded-md border border-hairline text-sm text-ink bg-surface-card placeholder:text-muted-soft focus:outline-none focus:border-primary"
          />
          <datalist id="export-source-options">
            {store.sourceHistory.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </section>

        <section>
          <SectionTitle>左右分栏比例</SectionTitle>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={40}
              max={70}
              step={1}
              value={ratioPct}
              onChange={(e) => setLeftWidthRatio(Number(e.target.value) / 100)}
              className="flex-1 accent-[var(--primary)]"
              aria-label="左栏宽度占比"
            />
            <span className="text-sm text-ink tabular-nums w-11 text-right">{ratioPct}%</span>
          </div>
        </section>

        {/* ── 字号（二级菜单）── */}
        <section>
          <SectionTitle>字号</SectionTitle>
          <AccordionSection title="字体大小" badge="展开精细调整">
            {FONT_SIZE_ROWS.map((row) => (
              <FontSizeRow
                key={row.key}
                label={row.label}
                value={store[row.key]}
                def={row.def}
                onChange={(v) => store[row.setter](v)}
              />
            ))}
          </AccordionSection>
        </section>

        {/* ── 内容选择（二级菜单） ── */}
        <section>
          <SectionTitle>内容选择</SectionTitle>
          <div className="space-y-2">
            <AccordionSection title="主要内容" badge={`${mainOn}/${MAIN_TOGGLES.length} 项`}>
              {MAIN_TOGGLES.map((t) => (
                <ToggleRow key={t.key} label={t.label} checked={store[t.key]} onChange={() => toggle(t.key)} />
              ))}
            </AccordionSection>
            <AccordionSection title="单词卡细节" badge={`${wordOn}/${WORD_DETAIL_TOGGLES.length} 项`}>
              {WORD_DETAIL_TOGGLES.map((t) => (
                <ToggleRow key={t.key} label={t.label} checked={store[t.key]} onChange={() => toggle(t.key)} />
              ))}
            </AccordionSection>
            <AccordionSection title="句子卡细节" badge={`${sentenceOn}/${SENTENCE_DETAIL_TOGGLES.length} 项`}>
              {SENTENCE_DETAIL_TOGGLES.map((t) => (
                <ToggleRow key={t.key} label={t.label} checked={store[t.key]} onChange={() => toggle(t.key)} />
              ))}
            </AccordionSection>
          </div>
          <div className="mt-2 pt-2 border-t border-hairline-soft space-y-2">
            <ToggleRow
              label="单栏版式（打印兼容）"
              checked={store.singleColumn}
              onChange={() => toggle('singleColumn')}
            />
            <ToggleRow
              label="解析与原文同页对齐"
              hint="左栏已解析词句与右栏解析尽量同页（更占版面）"
              checked={store.alignSamePage}
              onChange={() => toggle('alignSamePage')}
            />
          </div>
        </section>

        {/* ── 重置 ── */}
        <button
          onClick={resetAll}
          className="w-full py-2 rounded-md text-sm text-muted border border-hairline hover:text-ink hover:bg-surface-card transition-colors"
        >
          恢复默认设置
        </button>
      </div>
    </div>
  );
}
