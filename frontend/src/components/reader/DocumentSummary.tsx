import { useCallback, useEffect, useRef } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { generateSummaryStream, saveSummaryDraft } from '../../services/summaryApi';
import type { AIProvider } from '../../services/translateApi';
import Button from '../ui/Button';
import { TextArea } from '../ui/Input';

interface DocumentSummaryProps {
  apiKey: string | null;
  /** 打开 ApiKeyModal（API Key 守卫） */
  onRequireApiKey: () => void;
  provider: AIProvider;
}

const DRAFT_SAVE_DEBOUNCE_MS = 1000;

/**
 * 文末"全文总结"区域：文本输入框 + 一键 AI 总结（无输入）/ AI 修改（有输入）。
 *
 * 草稿保存策略：停止输入 1s 防抖 + 失焦立即 + 组件卸载立即；生成期间暂停。
 * 流式期间输入框锁定，完成后结果填回输入框（可继续编辑）。
 */
export default function DocumentSummary({ apiKey, onRequireApiKey, provider }: DocumentSummaryProps) {
  const {
    documentId,
    summary,
    summaryDraft,
    isSummarizing,
    summaryError,
    summaryStreamingText,
    setSummary,
    setSummaryDraft,
    setSummarizing,
    setSummaryError,
    appendSummaryStreamingText,
    clearSummaryStreamingText,
  } = useDocumentStore();

  const summaryAbortRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const draftRef = useRef<string>('');
  const documentIdRef = useRef<string | null>(documentId);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    documentIdRef.current = documentId;
    // 加载文档时重置保存去重基准
    lastSavedRef.current = '';
  }, [documentId]);

  // ── 输入框自适应高度：内容多高框就多高，完整展示全部内容 ──
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // 内容变化（输入/恢复/清空/AI 结果填回）后重新适配
  useEffect(() => {
    autoResizeTextarea();
  }, [summaryDraft, autoResizeTextarea]);

  // ── 草稿防抖保存 ──
  const persistDraft = useCallback(async () => {
    const docId = documentIdRef.current;
    const text = draftRef.current;
    // 生成期间不保存（后端 done 事件已落库最终结果，避免旧草稿覆盖）
    if (!docId || !text || text === lastSavedRef.current || useDocumentStore.getState().isSummarizing) {
      return;
    }
    lastSavedRef.current = text;
    try {
      await saveSummaryDraft(docId, text);
      setSummary(text);
    } catch {
      // 静默失败 — 下次输入/失焦会重试
      lastSavedRef.current = '';
    }
  }, [setSummary]);

  const scheduleDraftSave = useCallback((text: string) => {
    draftRef.current = text;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persistDraft(), DRAFT_SAVE_DEBOUNCE_MS);
  }, [persistDraft]);

  // 卸载时 flush 未保存的草稿
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      summaryAbortRef.current?.abort();
      const docId = documentIdRef.current;
      const text = draftRef.current;
      if (docId && text && text !== lastSavedRef.current && !useDocumentStore.getState().isSummarizing) {
        void saveSummaryDraft(docId, text);
      }
    };
  }, []);

  // ── 生成 / 修改（流式）──
  const handleGenerate = useCallback(
    async (mode: 'generate' | 'revise') => {
      const docId = documentIdRef.current;
      if (!docId) return;
      if (!apiKey) {
        onRequireApiKey();
        return;
      }
      if (mode === 'revise' && !useDocumentStore.getState().summaryDraft.trim()) return;

      summaryAbortRef.current?.abort();
      summaryAbortRef.current = new AbortController();
      const signal = summaryAbortRef.current.signal;

      setSummarizing(true);
      setSummaryError(null);
      clearSummaryStreamingText();

      try {
        const full = await generateSummaryStream(
          {
            document_id: docId,
            mode,
            user_summary: mode === 'revise' ? useDocumentStore.getState().summaryDraft : undefined,
            api_key: apiKey,
            provider,
          },
          (text) => appendSummaryStreamingText(text),
          signal
        );
        // 完成后填回输入框（后端已在 done 事件时落库）
        draftRef.current = full;
        lastSavedRef.current = full;
        setSummary(full);
        setSummaryDraft(full);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setSummaryError(err?.message || '总结失败');
        }
      } finally {
        setSummarizing(false);
        clearSummaryStreamingText();
        summaryAbortRef.current = null;
      }
    },
    [apiKey, provider, onRequireApiKey, setSummarizing, setSummaryError, clearSummaryStreamingText, appendSummaryStreamingText, setSummary, setSummaryDraft]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setSummaryDraft(text);
      scheduleDraftSave(text);
      // 即时适配高度（不等下一次渲染）
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    },
    [setSummaryDraft, scheduleDraftSave]
  );

  // 失焦立即保存（不再等防抖）
  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void persistDraft();
  }, [persistDraft]);

  // 清空：本地清空 + 保存空内容（后端写 NULL，重开文档不恢复）
  const handleClear = useCallback(() => {
    if (isSummarizing) return;
    setSummaryDraft('');
    setSummary(null);
    draftRef.current = '';
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const docId = documentIdRef.current;
    if (docId) {
      lastSavedRef.current = '';
      void saveSummaryDraft(docId, '').catch(() => {});
    }
  }, [isSummarizing, setSummaryDraft, setSummary]);

  // 流式文本自动滚动到底部
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [summaryStreamingText]);

  const hasDraft = summaryDraft.trim().length > 0;

  return (
    <section className="mt-10 pt-6 border-t border-hairline">
      <h3 className="text-display-sm font-display text-ink mb-3">全文总结</h3>

      {summaryError && !isSummarizing && (
        <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error">
          {summaryError}
        </div>
      )}

      <TextArea
        ref={textareaRef}
        value={summaryDraft}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={isSummarizing}
        placeholder="输入你的总结草稿，或点击下方按钮一键 AI 生成…"
        className="min-h-[140px]"
      />

      {/* 流式生成中 — 独立滚动框显示原始输出 */}
      {isSummarizing && (
        <div
          ref={streamRef}
          className="mt-3 border border-primary/30 bg-canvas-soft rounded-lg p-3.5 max-h-64 overflow-y-auto"
        >
          <span className="text-xs text-muted">正在生成…</span>
          <p className="whitespace-pre-wrap text-sm text-ink mt-1">
            {summaryStreamingText || '…'}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-muted-soft">
          {hasDraft ? 'AI 将基于全文修改你的草稿' : 'AI 将基于全文生成英文总结'}
        </p>
        <div className="flex items-center gap-2">
          {summary && (
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={isSummarizing}>
              清空
            </Button>
          )}
          {hasDraft ? (
            <Button
              variant="primary"
              size="sm"
              loading={isSummarizing}
              onClick={() => void handleGenerate('revise')}
              disabled={isSummarizing}
            >
              AI 修改
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={isSummarizing}
              onClick={() => void handleGenerate('generate')}
              disabled={isSummarizing}
            >
              一键 AI 总结
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
