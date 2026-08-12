import { useEffect, useState, useCallback, useRef } from 'react';
import { generateUUID } from '../utils/uuid';
import { useParams, useNavigate } from 'react-router-dom';
import { getPDFResult, updateParagraphs, deleteParagraph, mergeParagraphs, reorderParagraphs } from '../services/pdfApi';
import { useSplitPane } from '../hooks/useSplitPane';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint';
import { useUndoRedo } from '../hooks/useUndoRedo';
import ReviewHeader from '../components/review/ReviewHeader';
import PDFViewerPanel from '../components/review/PDFViewerPanel';
import EditableParagraphPanel from '../components/review/EditableParagraphPanel';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import type { ParagraphData } from '../components/review/EditableParagraph';

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ── Data fetching state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [selectedPages, setSelectedPages] = useState<number[] | null>(null);
  // 非 PDF 源（Word/PPT/图片/网页）没有 react-pdf 原稿预览，隐藏左栏
  const [isPdfSource, setIsPdfSource] = useState(true);

  // ── Editing state ──
  const [paragraphs, setParagraphs] = useState<ParagraphData[]>([]);
  const [dirtySet, setDirtySet] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  // ── Confirm dialog state ──
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    content: string;
    okText: string;
    cancelText: string;
    danger?: boolean;
    onOk: () => void;
  } | null>(null);

  // Track original text for dirty detection
  const originalTexts = useRef<Map<number, string>>(new Map());

  // ── Undo/Redo ──
  const { pushSnapshot, undo, redo, canUndo, canRedo, clearHistory } = useUndoRedo(50);

  // Debounce timer
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef<string>('');
  const latestParagraphsRef = useRef<ParagraphData[]>([]);
  const latestDirtySetRef = useRef<Set<number>>(new Set());
  const savedOrderRef = useRef<string[]>([]);

  // ── Split pane / mobile tab ──
  const { leftWidth, isDragging, handleDividerMouseDown, handleDividerTouchStart } = useSplitPane(0.60);
  const { isMobile } = useResponsiveBreakpoint();
  const [mobileTab, setMobileTab] = useState<'pdf' | 'editor'>('pdf');

  // ── Load document ──
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const result = await getPDFResult(id);
        if (cancelled) return;

        setTitle(result.title || result.source || '未命名文档');
        setSelectedPages(result.selected_pages ?? null);
        // 旧文档 file_ext 为空 → 默认 PDF 源
        setIsPdfSource((result.file_ext ?? '.pdf') === '.pdf');

        const paras: ParagraphData[] = result.paragraphs.map((p) => ({
          cid: generateUUID(),
          index: p.index,
          text_en: p.text,
          page_number: p.page_number ?? null,
        }));

        const originals = new Map<number, string>();
        for (const p of paras) {
          originals.set(p.index, p.text_en);
        }
        originalTexts.current = originals;

        setParagraphs(paras);
        setDirtySet(new Set());
        latestParagraphsRef.current = paras;
        latestDirtySetRef.current = new Set();
        savedOrderRef.current = paras.map((p) => p.cid);
        pushSnapshot(paras, new Set());
        lastPushedRef.current = '';
      } catch (err: any) {
        if (!cancelled) {
          const status = err?.response?.status;
          if (status === 425) {
            setError('文档解析尚未完成，请稍后再试。');
          } else if (status === 422) {
            setError('PDF 解析失败，请重新上传。');
          } else if (status === 404) {
            setError('文档不存在或已被删除。');
          } else {
            setError(err?.message || '加载文档失败');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  // ── Debounced snapshot ──
  const scheduleTextSnapshot = useCallback(
    (paragraphs: ParagraphData[], dirtySet: Set<number>) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        const currentParas = latestParagraphsRef.current;
        const currentDirty = latestDirtySetRef.current;
        const key = JSON.stringify({ paras: currentParas, dirty: Array.from(currentDirty) });
        if (key !== lastPushedRef.current) {
          lastPushedRef.current = key;
          pushSnapshot(currentParas, currentDirty);
        }
      }, 800);
    },
    [pushSnapshot],
  );

  const flushPendingSnapshot = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      const currentParas = latestParagraphsRef.current;
      const currentDirty = latestDirtySetRef.current;
      const key = JSON.stringify({ paras: currentParas, dirty: Array.from(currentDirty) });
      if (key !== lastPushedRef.current) {
        lastPushedRef.current = key;
        pushSnapshot(currentParas, currentDirty);
      }
    }
  }, [pushSnapshot]);

  const cancelPendingSnapshot = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // ── Paragraph change ──
  const handleParagraphChange = useCallback(
    (index: number, text: string) => {
      setParagraphs((prev) => {
        const next = prev.map((p) => (p.index === index ? { ...p, text_en: text } : p));
        latestParagraphsRef.current = next;
        return next;
      });
      setDirtySet((prev) => {
        const next = new Set(prev);
        const original = originalTexts.current.get(index) ?? '';
        if (text !== original) next.add(index);
        else next.delete(index);
        latestDirtySetRef.current = next;
        scheduleTextSnapshot(latestParagraphsRef.current, next);
        return next;
      });
    },
    [scheduleTextSnapshot],
  );

  // ── Delete paragraph ──
  const handleDelete = useCallback(
    async (index: number) => {
      if (!id) return;
      cancelPendingSnapshot();
      try {
        await deleteParagraph(id, index);
        setParagraphs((prev) => {
          const filtered = prev.filter((p) => p.index !== index);
          const reindexed = filtered.map((p) =>
            p.index > index ? { ...p, index: p.index - 1 } : p
          );
          latestParagraphsRef.current = reindexed;
          return reindexed;
        });
        const newOriginals = new Map<number, string>();
        for (const [origIdx, text] of originalTexts.current.entries()) {
          if (origIdx === index) continue;
          newOriginals.set(origIdx > index ? origIdx - 1 : origIdx, text);
        }
        originalTexts.current = newOriginals;
        setDirtySet((prev) => {
          const next = new Set<number>();
          for (const i of prev) {
            if (i === index) continue;
            next.add(i > index ? i - 1 : i);
          }
          latestDirtySetRef.current = next;
          const paras = latestParagraphsRef.current;
          lastPushedRef.current = JSON.stringify({ paras, dirty: Array.from(next) });
          pushSnapshot(paras, next);
          return next;
        });
      } catch (err: any) {
        // Silently handle
      }
    },
    [id, pushSnapshot, cancelPendingSnapshot]
  );

  // ── Merge paragraph ──
  const handleMergeDown = useCallback(
    async (index: number) => {
      if (!id) return;
      const nextPara = paragraphs.find((p) => p.index === index + 1);
      if (!nextPara) return;
      cancelPendingSnapshot();
      try {
        await mergeParagraphs(id, index, index + 1);
        setParagraphs((prev) => {
          const current = prev.find((p) => p.index === index);
          if (!current) return prev;
          const merged = prev
            .filter((p) => p.index !== index + 1)
            .map((p) => {
              if (p.index === index) return { ...p, text_en: current.text_en + ' ' + nextPara.text_en };
              if (p.index > index + 1) return { ...p, index: p.index - 1 };
              return p;
            });
          latestParagraphsRef.current = merged;
          return merged;
        });
        const newOriginals = new Map<number, string>();
        for (const [origIdx, text] of originalTexts.current.entries()) {
          if (origIdx === index + 1) continue;
          if (origIdx === index) newOriginals.set(index, text + ' ' + (originalTexts.current.get(index + 1) || ''));
          else if (origIdx > index + 1) newOriginals.set(origIdx - 1, text);
          else newOriginals.set(origIdx, text);
        }
        originalTexts.current = newOriginals;
        setDirtySet((prev) => {
          const next = new Set<number>();
          for (const i of prev) {
            if (i === index + 1) continue;
            if (i === index) next.add(i);
            else if (i > index + 1) next.add(i - 1);
            else next.add(i);
          }
          latestDirtySetRef.current = next;
          pushSnapshot(latestParagraphsRef.current, next);
          return next;
        });
      } catch { /* handle silently */ }
    },
    [id, paragraphs, pushSnapshot, cancelPendingSnapshot]
  );

  // ── Reorder ──
  const handleReorder = useCallback(
    (activeCid: string, overCid: string) => {
      if (activeCid === overCid) return;
      cancelPendingSnapshot();
      setParagraphs((prev) => {
        const oldIdx = prev.findIndex((p) => p.cid === activeCid);
        const newIdx = prev.findIndex((p) => p.cid === overCid);
        if (oldIdx === -1 || newIdx === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(oldIdx, 1);
        next.splice(newIdx, 0, moved);
        latestParagraphsRef.current = next;
        pushSnapshot(next, latestDirtySetRef.current);
        return next;
      });
    },
    [pushSnapshot, cancelPendingSnapshot],
  );

  const reorderPending = (() => {
    const currentOrder = latestParagraphsRef.current.map((p) => p.cid);
    if (currentOrder.length !== savedOrderRef.current.length) return true;
    return currentOrder.some((cid, i) => cid !== savedOrderRef.current[i]);
  })();

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!id) return;
    const needsReorder =
      latestParagraphsRef.current.length > 0 &&
      latestParagraphsRef.current.some((p, i) => savedOrderRef.current[i] !== p.cid);
    const needsTextSave = dirtySet.size > 0;
    if (!needsReorder && !needsTextSave) return;

    setSaving(true);
    let currentDirtySet = dirtySet;
    let currentParagraphs = paragraphs;

    try {
      if (needsReorder) {
        const orderedIndices = latestParagraphsRef.current.map((p) => p.index);
        await reorderParagraphs(id, orderedIndices);

        const cidToOriginal = new Map<string, string>();
        for (const [idx, text] of originalTexts.current.entries()) {
          const para = latestParagraphsRef.current.find((p) => p.index === idx);
          if (para) cidToOriginal.set(para.cid, text);
        }
        const cidToDirty = new Map<string, boolean>();
        for (const idx of dirtySet) {
          const para = latestParagraphsRef.current.find((p) => p.index === idx);
          if (para) cidToDirty.set(para.cid, true);
        }

        const reindexed = latestParagraphsRef.current.map((p, i) => ({ ...p, index: i }));
        const newOriginals = new Map<number, string>();
        for (const para of reindexed) {
          const orig = cidToOriginal.get(para.cid);
          newOriginals.set(para.index, orig !== undefined ? orig : para.text_en);
        }
        originalTexts.current = newOriginals;

        const newDirty = new Set<number>();
        for (const para of reindexed) {
          if (cidToDirty.has(para.cid)) newDirty.add(para.index);
        }

        setParagraphs(reindexed);
        latestParagraphsRef.current = reindexed;
        setDirtySet(newDirty);
        latestDirtySetRef.current = newDirty;
        savedOrderRef.current = reindexed.map((p) => p.cid);
        currentDirtySet = newDirty;
        currentParagraphs = reindexed;
      }

      if (needsTextSave) {
        const dirtyItems = Array.from(currentDirtySet)
          .map((index) => {
            const para = currentParagraphs.find((p) => p.index === index);
            return para ? { index, text_en: para.text_en } : null;
          })
          .filter(Boolean) as { index: number; text_en: string }[];

        if (dirtyItems.length > 0) {
          await updateParagraphs(id, dirtyItems);
          for (const item of dirtyItems) {
            originalTexts.current.set(item.index, item.text_en);
          }
        }
      }

      setDirtySet(new Set());
      latestDirtySetRef.current = new Set();
      clearHistory();
      lastPushedRef.current = '';
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || '请检查网络连接后重试';
      setConfirmDialog({
        title: '保存失败',
        content: `[HTTP ${status || '?'}] ${detail}`,
        okText: '确定',
        cancelText: '',
        danger: true,
        onOk: () => setConfirmDialog(null),
      });
    } finally {
      setSaving(false);
    }
  }, [id, dirtySet, paragraphs, clearHistory]);

  // ── Undo/Redo ──
  const handleUndo = useCallback(() => {
    flushPendingSnapshot();
    const snapshot = undo();
    if (snapshot) {
      setParagraphs(snapshot.paragraphs);
      setDirtySet(new Set(snapshot.dirtyIndices));
      latestParagraphsRef.current = snapshot.paragraphs;
      latestDirtySetRef.current = new Set(snapshot.dirtyIndices);
    }
  }, [undo, flushPendingSnapshot]);

  const handleRedo = useCallback(() => {
    const snapshot = redo();
    if (snapshot) {
      setParagraphs(snapshot.paragraphs);
      setDirtySet(new Set(snapshot.dirtyIndices));
      latestParagraphsRef.current = snapshot.paragraphs;
      latestDirtySetRef.current = new Set(snapshot.dirtyIndices);
    }
  }, [redo]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const isEditableFocused = (): boolean => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'input') return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.code === 'KeyZ' && !e.shiftKey) {
        if (isEditableFocused()) return;
        e.preventDefault();
        handleUndo();
      } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
        if (isEditableFocused()) return;
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      clearHistory();
    };
  }, [clearHistory]);

  // ── Navigation ──
  const handleStartReading = useCallback(() => {
    const unsaved = dirtySet.size > 0 || reorderPending;
    if (unsaved) {
      setConfirmDialog({
        title: '有未保存的修改',
        content: '确定不保存修改直接开始阅读吗？未保存的修改将会丢失。',
        okText: '直接阅读',
        cancelText: '先去保存',
        danger: true,
        onOk: () => navigate(`/document/${id}`),
      });
    } else {
      navigate(`/document/${id}`);
    }
  }, [dirtySet, id, navigate, reorderPending]);

  const handleBack = useCallback(() => {
    const unsaved = dirtySet.size > 0 || reorderPending;
    if (unsaved) {
      setConfirmDialog({
        title: '有未保存的修改',
        content: '确定离开吗？未保存的修改将会丢失。',
        okText: '离开',
        cancelText: '继续编辑',
        danger: true,
        onOk: () => navigate('/'),
      });
    } else {
      navigate('/');
    }
  }, [dirtySet, navigate, reorderPending]);

  // ── Unsaved changes guard ──
  useEffect(() => {
    if (dirtySet.size === 0 && !reorderPending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtySet.size, reorderPending]);

  // ── Render states ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-canvas">
        <Spinner size="lg" label="加载文档..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-canvas gap-4">
        <div className="w-16 h-16 rounded-full bg-error/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink">加载失败</h3>
        <p className="text-muted max-w-sm text-center">{error}</p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => navigate('/')}>返回首页</Button>
          <Button variant="primary" onClick={() => window.location.reload()}>重新加载</Button>
        </div>
      </div>
    );
  }

  const hasUnsaved = dirtySet.size > 0 || reorderPending;

  return (
    <div className="flex flex-col h-screen bg-canvas">
      {/* Header */}
      <ReviewHeader
        title={title}
        hasUnsaved={hasUnsaved}
        saving={saving}
        onSave={handleSave}
        onStartReading={handleStartReading}
        onBack={handleBack}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* Main content */}
      {isMobile ? (
        /* ── Mobile: tab toggle layout (non-PDF sources hide the preview tab) ── */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {isPdfSource ? (
            <>
              {/* Tab bar */}
              <div className="flex border-b border-hairline bg-canvas flex-shrink-0">
                <button
                  onClick={() => setMobileTab('pdf')}
                  className={[
                    'flex-1 py-2.5 text-sm font-medium text-center transition-colors border-b-2',
                    mobileTab === 'pdf'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-body',
                  ].join(' ')}
                >
                  PDF 预览
                </button>
                <button
                  onClick={() => setMobileTab('editor')}
                  className={[
                    'flex-1 py-2.5 text-sm font-medium text-center transition-colors border-b-2',
                    mobileTab === 'editor'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-body',
                  ].join(' ')}
                >
                  编辑段落
                </button>
              </div>

              {/* Tab content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {mobileTab === 'pdf' ? (
                  id && <PDFViewerPanel taskId={id} width={window.innerWidth} selectedPages={selectedPages} />
                ) : (
                  <EditableParagraphPanel
                    paragraphs={paragraphs}
                    dirtySet={dirtySet}
                    onParagraphChange={handleParagraphChange}
                    onDelete={handleDelete}
                    onMergeDown={handleMergeDown}
                    onReorder={handleReorder}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden">
              <EditableParagraphPanel
                paragraphs={paragraphs}
                dirtySet={dirtySet}
                onParagraphChange={handleParagraphChange}
                onDelete={handleDelete}
                onMergeDown={handleMergeDown}
                onReorder={handleReorder}
              />
            </div>
          )}
        </div>
      ) : (
        /* ── Desktop: split pane layout ── */
        <div
          className="flex flex-1 overflow-hidden"
          style={{
            cursor: isDragging ? 'col-resize' : undefined,
            userSelect: isDragging ? 'none' : undefined,
          }}
        >
          {/* Left: PDF viewer (PDF sources only; others hide the panel) */}
          {isPdfSource && (
            <>
              <div className="h-full flex-shrink-0" style={{ width: leftWidth }}>
                {id && <PDFViewerPanel taskId={id} width={leftWidth} selectedPages={selectedPages} />}
              </div>

              {/* Divider */}
              <div
                onMouseDown={handleDividerMouseDown}
                onTouchStart={handleDividerTouchStart}
                className="w-[6px] cursor-col-resize flex-shrink-0 flex items-center justify-center transition-colors touch-action-none"
                style={{ background: isDragging ? 'var(--primary)' : 'var(--hairline)' }}
              >
                <div
                  className="w-0.5 h-10 rounded-sm"
                  style={{ background: isDragging ? '#fff' : '#c4bfb0' }}
                />
              </div>
            </>
          )}

          {/* Right: editable paragraphs */}
          <div className="flex-1 h-full overflow-hidden">
            <EditableParagraphPanel
              paragraphs={paragraphs}
              dirtySet={dirtySet}
              onParagraphChange={handleParagraphChange}
              onDelete={handleDelete}
              onMergeDown={handleMergeDown}
              onReorder={handleReorder}
            />
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <Modal
        open={confirmDialog !== null}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ''}
        width="420px"
        footer={
          <>
            {confirmDialog?.cancelText && (
              <Button variant="secondary" onClick={() => setConfirmDialog(null)}>
                {confirmDialog.cancelText}
              </Button>
            )}
            <Button
              variant={confirmDialog?.danger ? 'danger' : 'primary'}
              onClick={() => {
                confirmDialog?.onOk();
                setConfirmDialog(null);
              }}
            >
              {confirmDialog?.okText || '确定'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-body">{confirmDialog?.content}</p>
      </Modal>
    </div>
  );
}
