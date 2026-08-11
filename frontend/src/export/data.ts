/**
 * 导出数据装配：从 documentStore 同步取数，过滤未完成条目。
 * 纯前端，不请求后端。
 */
import { useDocumentStore } from '../stores/documentStore';
import type { ParagraphResult } from '../services/pdfApi';
import type { WordAnalysisResult } from '../services/wordAnalysisApi';
import type { SentenceAnalysisResult } from '../services/sentenceAnalysisApi';

export interface ExportData {
  title: string;
  paragraphs: ParagraphResult[];
  /** 段落 index → 中文翻译 */
  translations: Record<number, string>;
  /** 按段落 index 升序 */
  words: WordAnalysisResult[];
  /** 按段落 index 升序 */
  sentences: SentenceAnalysisResult[];
  summary: string | null;
}

/** 判断单词解析是否为可导出完整结果 */
function isWordComplete(w: WordAnalysisResult): boolean {
  return !w._pending && Boolean(w.word && (w.definition || w.definition_zh));
}

/** 判断句子解析是否完整 */
function isSentenceComplete(s: SentenceAnalysisResult): boolean {
  return !s._pending && Boolean(s.sentence_text && s.content);
}

export function collectExportData(): ExportData {
  const state = useDocumentStore.getState();
  const words = Object.values(state.wordAnalyses)
    .filter(isWordComplete)
    .sort((a, b) => a.paragraph_index - b.paragraph_index || a.word.localeCompare(b.word));
  const sentences = Object.values(state.sentenceAnalyses)
    .filter(isSentenceComplete)
    .sort(
      (a, b) =>
        a.paragraph_index - b.paragraph_index || a.sentence_index - b.sentence_index
    );

  return {
    title: state.title || 'Untitled',
    paragraphs: state.paragraphs,
    translations: state.translations,
    words,
    sentences,
    summary: state.summary,
  };
}
