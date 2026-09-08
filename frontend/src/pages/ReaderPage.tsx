import { useEffect, useState, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getPDFResult, getPDFStatus } from '../services/pdfApi';
import { translateParagraphsStream } from '../services/translateApi';
import type { AIProvider } from '../services/translateApi';
import { analyzeWordsStream } from '../services/wordAnalysisApi';
import type { WordEntry, WordAnalysisResult } from '../services/wordAnalysisApi';
import { analyzeSentencesStream } from '../services/sentenceAnalysisApi';
import type { SentenceEntry, SentenceAnalysisResult } from '../services/sentenceAnalysisApi';
import { getStoredDeepseekKey, getStoredAIProvider } from '../components/common/ApiKeyModal';
import ApiKeyModal from '../components/common/ApiKeyModal';
import { useShallow } from 'zustand/react/shallow';
import { useDocumentStore } from '../stores/documentStore';
import { useReaderStore, BG_COLORS } from '../stores/readerStore';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint';
import { destroy as destroyPlayer } from '../hooks/useParagraphAudioPlayer';
import { useAudioPlayerStore } from '../stores/audioPlayerStore';
import ReaderHeader from '../components/reader/ReaderHeader';
import ErrorBanner from '../components/reader/ErrorBanner';
import ReadingArea from '../components/reader/ReadingArea';
import AudioPlayerBar from '../components/reader/AudioPlayerBar';
import StudyPanel from '../components/reader/StudyPanel';
import StudySheet from '../components/reader/StudySheet';
import FocusedAnalysisSheet from '../components/reader/FocusedAnalysisSheet';
import QAPanel from '../components/reader/QAPanel';
import PanelSwitch from '../components/reader/PanelSwitch';
import { useQaStore } from '../stores/qaStore';
import { setOnOpenFocusedAnalysis } from '../components/reader/ParagraphBlock';
import { setOnOpenPanel, triggerScrollToAnalysis } from '../components/reader/StudyPanel';
import { scrollToParagraph } from '../utils/scrollToParagraph';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

// Bounded automatic retries for paragraphs that come back untranslated
// (e.g. a per-paragraph AI failure returns an empty result). Prevented from
// looping forever by this cap; reset whenever a document is (re)loaded.
const MAX_AUTO_RETRIES = 2;

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusParagraphParam = searchParams.get('paragraph');
  const focusWordParam = searchParams.get('word');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRetryCountRef = useRef(0);
  const pendingWidthRef = useRef(0);
  const widthRafRef = useRef<number | null>(null);
  // 轮询回调里只能读到创建时的闭包值 —— error 用 ref 同步，失败后立即停表
  const errorRef = useRef<string | null>(null);

  // 细粒度订阅：流式文本/进度等与页面外壳无关的字段变化不再触发整页重渲染
  const {
    setDocument,
    reset,
    title,
    titleZh,
    setTitleZh,
    paragraphs,
    documentId,
    translations,
    isTranslating,
    translationError,
    updateTranslations,
    setTranslating,
    setTranslationError,
    selectedWords,
    wordAnalyses,
    isAnalyzing,
    analysisError,
    clearWordSelection,
    setWordAnalyses,
    setAnalyzing,
    setAnalysisError,
    setAnalysisProgress,
    removePendingWordAnalyses,
    appendStreamingText,
    clearStreamingTexts,
    appendSentenceStreamingText,
    clearSentenceStreamingTexts,
    selectedSentences,
    sentenceAnalyses,
    isAnalyzingSentences,
    sentenceAnalysisError,
    clearSentenceSelection,
    setSentenceAnalyses,
    setAnalyzingSentences,
    setSentenceAnalysisError,
  } = useDocumentStore(useShallow((s) => ({
    setDocument: s.setDocument,
    reset: s.reset,
    title: s.title,
    titleZh: s.titleZh,
    setTitleZh: s.setTitleZh,
    paragraphs: s.paragraphs,
    documentId: s.documentId,
    translations: s.translations,
    isTranslating: s.isTranslating,
    translationError: s.translationError,
    updateTranslations: s.updateTranslations,
    setTranslating: s.setTranslating,
    setTranslationError: s.setTranslationError,
    selectedWords: s.selectedWords,
    wordAnalyses: s.wordAnalyses,
    isAnalyzing: s.isAnalyzing,
    analysisError: s.analysisError,
    clearWordSelection: s.clearWordSelection,
    setWordAnalyses: s.setWordAnalyses,
    setAnalyzing: s.setAnalyzing,
    setAnalysisError: s.setAnalysisError,
    setAnalysisProgress: s.setAnalysisProgress,
    removePendingWordAnalyses: s.removePendingWordAnalyses,
    appendStreamingText: s.appendStreamingText,
    clearStreamingTexts: s.clearStreamingTexts,
    appendSentenceStreamingText: s.appendSentenceStreamingText,
    clearSentenceStreamingTexts: s.clearSentenceStreamingTexts,
    selectedSentences: s.selectedSentences,
    sentenceAnalyses: s.sentenceAnalyses,
    isAnalyzingSentences: s.isAnalyzingSentences,
    sentenceAnalysisError: s.sentenceAnalysisError,
    clearSentenceSelection: s.clearSentenceSelection,
    setSentenceAnalyses: s.setSentenceAnalyses,
    setAnalyzingSentences: s.setAnalyzingSentences,
    setSentenceAnalysisError: s.setSentenceAnalysisError,
  })));

  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [translationTrigger, setTranslationTrigger] = useState(0);

  // ── AI provider (global setting from ApiKeyModal) ──
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(getStoredAIProvider);

  const getProviderApiKey = useCallback((_provider: AIProvider): string => {
    return getStoredDeepseekKey();
  }, []);

  const getProviderLabel = (_provider: AIProvider): string => {
    return 'DeepSeek';
  };

  // ── Typography preferences ──
  const { bgColor } = useReaderStore();
  const bgColorConfig = BG_COLORS.find(c => c.key === bgColor) ?? BG_COLORS[0];
  const bgColorValue = bgColorConfig.value;
  // 随背景联动的配套色（滚动条 + 线条/分隔线 + 弹层底色），
  // 注入根容器后由后代元素（含 webkit 滚动条伪元素）继承
  const bgAdaptiveStyle = {
    '--scrollbar-thumb': bgColorConfig.adaptive?.thumb,
    '--scrollbar-thumb-hover': bgColorConfig.adaptive?.thumbHover,
    '--reader-line': bgColorConfig.adaptive?.line,
    '--reader-line-soft': bgColorConfig.adaptive?.lineSoft,
    '--reader-surface': bgColorConfig.adaptive?.surface,
  } as CSSProperties;

  // ── Split layout state (persisted) ──
  const SPLIT_WIDTH_KEY = 'reader_split_width';
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem(SPLIT_WIDTH_KEY);
    if (saved !== null) {
      const val = parseFloat(saved);
      if (!isNaN(val) && val >= 300 && val <= window.innerWidth - 320) return val;
    }
    return window.innerWidth * 0.55;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const { isMobile, isTouchDevice } = useResponsiveBreakpoint();
  const [studySheetOpen, setStudySheetOpen] = useState(false);
  const [focusedAnalysis, setFocusedAnalysis] = useState<{ type: 'word' | 'sentence'; key: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  // 右侧面板内容切换：解析 / AI 问答（同一滑入滑出容器）
  const [activePanel, setActivePanel] = useState<'study' | 'qa'>('study');
  // 打开面板瞬间抑制正文宽度过渡（原文直接到位，不播放动画）
  const [panelJustOpened, setPanelJustOpened] = useState(false);
  const playerStatus = useAudioPlayerStore((s) => s.status);

  // ── 朗读播放器单例清理（离开页面停止播放）──
  useEffect(() => {
    return () => destroyPlayer();
  }, []);

  const hasAnalyses = useMemo(
    () => Object.keys(wordAnalyses).length > 0
      || Object.keys(sentenceAnalyses).length > 0
      || isAnalyzing
      || isAnalyzingSentences
      || !!analysisError
      || !!sentenceAnalysisError,
    [wordAnalyses, sentenceAnalyses, isAnalyzing, isAnalyzingSentences, analysisError, sentenceAnalysisError]
  );
  // AI 问答面板即使还没有解析结果也可打开（分栏随之出现）
  const panelVisible = hasAnalyses || activePanel === 'qa';
  const selectedWordCount = useMemo(() => Object.keys(selectedWords).length, [selectedWords]);
  const selectedSentenceCount = useMemo(() => Object.keys(selectedSentences).length, [selectedSentences]);
  const hasUntranslated = useMemo(
    () => paragraphs.some((p) => p.text.trim() && !translations[p.index]),
    [paragraphs, translations]
  );

  // ── Main Reader 内容（提前 useMemo：组件下方存在 loading/error 早退分支，
  //    Hooks 不能出现在条件返回之后）──
  const apiKey = getProviderApiKey(selectedProvider);
  const readingAreaContent = useMemo(
    () => (
      <>
        {/* API key prompt */}
        {!apiKey && hasUntranslated && (
          <div className="mb-6 p-4 bg-reader-surface border border-reader-line-soft rounded-xl shadow-soft flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              </span>
              <span className="text-sm text-body-strong">配置 {getProviderLabel(selectedProvider)} API Key 以启用段落翻译</span>
            </div>
            <Button variant="primary" size="sm" onClick={() => setShowApiKeyModal(true)}>
              配置
            </Button>
          </div>
        )}
        {/* Error banners */}
        {translationError && !isTranslating && (
          <ErrorBanner message={translationError} className="mb-4" />
        )}
        {analysisError && !isAnalyzing && (
          <ErrorBanner message={analysisError} className="mb-4" />
        )}
        {sentenceAnalysisError && !isAnalyzingSentences && (
          <ErrorBanner message={sentenceAnalysisError} className="mb-4" />
        )}
        <ReadingArea
          isTouchDevice={isTouchDevice}
          apiKey={apiKey}
          onRequireApiKey={() => setShowApiKeyModal(true)}
          provider={selectedProvider}
        />
      </>
    ),
    [
      apiKey,
      hasUntranslated,
      translationError,
      isTranslating,
      analysisError,
      isAnalyzing,
      sentenceAnalysisError,
      isAnalyzingSentences,
      isTouchDevice,
      selectedProvider,
    ],
  );

  // Track parse status for polling
  const parseStatusRef = useRef<string>('');

  // ── Draggable divider ──
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = leftWidth;
    },
    [leftWidth]
  );

  const handleDividerTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.touches[0].clientX;
      dragStartWidth.current = leftWidth;
    },
    [leftWidth]
  );

  useEffect(() => {
    if (!isDragging) return;
    const getClientX = (e: MouseEvent | TouchEvent): number => {
      if ('touches' in e) return e.touches[0].clientX;
      return e.clientX;
    };
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const delta = getClientX(e) - dragStartX.current;
      pendingWidthRef.current = Math.max(300, Math.min(window.innerWidth - 320, dragStartWidth.current + delta));
      // rAF 合并同帧多次 mousemove，避免正文分栏逐事件重排
      if (widthRafRef.current === null) {
        widthRafRef.current = requestAnimationFrame(() => {
          widthRafRef.current = null;
          setLeftWidth(pendingWidthRef.current);
        });
      }
    };
    const handleEnd = () => {
      if (widthRafRef.current !== null) {
        cancelAnimationFrame(widthRafRef.current);
        widthRafRef.current = null;
      }
      setLeftWidth(pendingWidthRef.current);
      setIsDragging(false);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    return () => {
      if (widthRafRef.current !== null) {
        cancelAnimationFrame(widthRafRef.current);
        widthRafRef.current = null;
      }
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  // Persist split width when dragging ends
  const prevDragging = useRef(false);
  useEffect(() => {
    if (prevDragging.current && !isDragging) {
      localStorage.setItem(SPLIT_WIDTH_KEY, String(Math.round(leftWidth)));
    }
    prevDragging.current = isDragging;
  }, [isDragging, leftWidth]);

  // ── Document loading ──
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const tryLoadDocument = async () => {
      try {
        const status = await getPDFStatus(id);
        if (cancelled) return;

        if (status.status === 'failed') {
          setError('PDF 解析失败，请返回重新上传');
          setLoading(false);
          return;
        }

        if (status.status === 'awaiting_selection') {
          setParseStatus('awaiting_selection');
          parseStatusRef.current = 'awaiting_selection';
          setLoading(false);
          return;
        }

        if (status.status !== 'completed') {
          setParseStatus(status.status);
          parseStatusRef.current = status.status;
          return;
        }

        const result = await getPDFResult(id);
        if (!cancelled) {
          setDocument(result);
          setParseStatus('completed');
          parseStatusRef.current = 'completed';
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          const status = err?.response?.status;
          if (status === 425) {
            setParseStatus('processing');
            parseStatusRef.current = 'processing';
          } else if (status === 404) {
            setError('文档不存在');
            errorRef.current = '文档不存在';
            setLoading(false);
          } else {
            const detail = err?.response?.data?.detail || '加载失败';
            setError(detail);
            errorRef.current = detail;
            setLoading(false);
          }
          // 失败即停表：闭包里的 error 永远是初始 null，继续轮询只会白费请求
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      }
    };

    tryLoadDocument();

    pollRef.current = setInterval(() => {
      if (
        parseStatusRef.current === 'completed' ||
        parseStatusRef.current === 'awaiting_selection' ||
        errorRef.current
      ) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        return;
      }
      tryLoadDocument();
    }, 2000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      autoRetryCountRef.current = 0;
      reset();
    };
  }, [id]);

  // ── Register focused analysis callback (mobile) ──
  useEffect(() => {
    if (isMobile) {
      setOnOpenFocusedAnalysis((type, key) => {
        setFocusedAnalysis({ type, key });
      });
      return () => setOnOpenFocusedAnalysis(null);
    }
  }, [isMobile]);

  // ── 外部跳转定位（如单词本来源链接 ?paragraph=N&word=x）：
  //    段落滚动闪动 + 单词 token 高亮 + 解析面板定位到单词卡片，同步触发。
  //    面板卡片未就绪时由 _scrollToAnalysis 内部的重试兜底，无需额外延时 ──
  useEffect(() => {
    if (!focusParagraphParam || loading || paragraphs.length === 0) return;
    const index = parseInt(focusParagraphParam, 10);
    if (Number.isNaN(index)) {
      setSearchParams({}, { replace: true });
      return;
    }
    const word = focusWordParam;
    scrollToParagraph(index, { block: isMobile ? 'start' : 'center', word });
    if (word) {
      // 移动端先弹出底部解析面板；面板尚未挂载时 triggerScrollToAnalysis
      // 会自动转为挂起请求，待挂载后执行
      if (isMobile) setStudySheetOpen(true);
      triggerScrollToAnalysis(`${index}:${word.toLowerCase()}`, 'words');
    }
    setSearchParams({}, { replace: true });
  }, [focusParagraphParam, focusWordParam, loading, paragraphs.length, isMobile, setSearchParams]);

  // ── Register open-panel callback (for clicking analyzed words/sentences when panel is closed) ──
  const handleOpenPanel = useCallback(() => {
    setActivePanel('study');
    setPanelOpen(true);
    setPanelJustOpened(true);
    requestAnimationFrame(() => setPanelJustOpened(false));
  }, []);

  useEffect(() => {
    setOnOpenPanel(() => handleOpenPanel());
    return () => setOnOpenPanel(null);
  }, [handleOpenPanel]);

  // ── Open the AI Q&A panel (header button / floating bar「问 AI」) ──
  const handleOpenQa = useCallback(() => {
    setActivePanel('qa');
    setPanelOpen(true);
    setPanelJustOpened(true);
    requestAnimationFrame(() => setPanelJustOpened(false));
    if (isMobile) setStudySheetOpen(true);
  }, [isMobile]);

  // ── AI 问答会话：进入页面懒加载历史，离开时丢弃内存状态 ──
  useEffect(() => {
    if (documentId) void useQaStore.getState().loadConversation(documentId);
  }, [documentId]);
  useEffect(() => {
    return () => useQaStore.getState().reset();
  }, []);

  // ── 面板内「解析 ⇄ AI 问答」切换（桌面头部内嵌 / 移动端 Sheet 顶栏）──
  const handleSwitchToStudy = useCallback(() => {
    setActivePanel('study');
  }, []);

  const handleSwitchToQa = useCallback(() => {
    setActivePanel('qa');
    if (isMobile) setStudySheetOpen(true);
  }, [isMobile]);

  // 「问 AI」浮动按钮：把当前选中句子带入问答面板作为引用句
  const handleAskAi = useCallback(() => {
    const first = Object.entries(selectedSentences)[0];
    if (first) {
      const [key, val] = first;
      const paragraphIndex = parseInt(key.split(':')[0], 10);
      if (!isNaN(paragraphIndex)) {
        useQaStore.getState().setPendingQuote({
          paragraphIndex,
          sentenceText: val.text,
        });
      }
    }
    clearSentenceSelection();
    handleOpenQa();
  }, [selectedSentences, clearSentenceSelection, handleOpenQa]);

  // ── Auto-translate (streaming) ──
  useEffect(() => {
    if (paragraphs.length === 0 || isTranslating) return;
    const apiKey = getProviderApiKey(selectedProvider);
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    // Only non-whitespace, not-yet-translated paragraphs are submitted.
    // `indices` carries each paragraph's real index so the backend persists
    // every translation to the correct paragraph even when this is a subset.
    const untranslated = paragraphs.filter(
      (p) => p.text.trim() && !translations[p.index]
    );
    // 大标题随段落翻译流程一并翻译（title_zh 已持久化则跳过）
    const titleText = title?.trim();
    const needsTitle = Boolean(titleText && !titleZh);
    if (untranslated.length === 0 && !needsTitle) return;

    setTranslating(true);
    setTranslationError(null);

    const abortController = new AbortController();
    const untranslatedTexts = untranslated.map((p) => p.text);
    const indices = untranslated.map((p) => p.index);
    let completedOk = false;

    translateParagraphsStream(
      untranslatedTexts,
      (batchIndex: number, translation: string) => {
        const realIndex = untranslated[batchIndex].index;
        updateTranslations([{ index: realIndex, text: translation }]);
      },
      apiKey,
      documentId || undefined,
      selectedProvider,
      indices,
      abortController.signal,
      needsTitle ? titleText : undefined,
      (t) => setTitleZh(t)
    )
      .then(() => {
        completedOk = true;
      })
      .catch((err: any) => {
        if (err.name !== 'AbortError') {
          const detail = err?.message || '翻译失败';
          setTranslationError(detail);
        }
      })
      .finally(() => {
        setTranslating(false);
        // Retry only when the stream completed normally but some paragraphs
        // still came back untranslated (e.g. a per-paragraph failure). Reads
        // the latest store state so already-translated paragraphs aren't sent
        // again; bounded by MAX_AUTO_RETRIES so this can't loop forever.
        if (completedOk && autoRetryCountRef.current < MAX_AUTO_RETRIES) {
          const state = useDocumentStore.getState();
          const stillMissing = state.paragraphs.filter(
            (p) => p.text.trim() && !state.translations[p.index]
          );
          if (stillMissing.length > 0) {
            autoRetryCountRef.current += 1;
            setTranslationTrigger((n) => n + 1);
          }
        }
      });

    // 注意：titleZh 不入依赖 —— 标题翻译事件 setTitleZh 会触发重跑并 abort
    // 正在进行的段落流。重试时 effect 重新渲染，闭包内能读到最新 titleZh。
    return () => abortController.abort();
  }, [documentId, title, paragraphs.length, translationTrigger, selectedProvider]);

  // ── Auto-open panel when analysis starts ──
  useEffect(() => {
    if (isAnalyzing || isAnalyzingSentences) {
      handleOpenPanel();
      if (isMobile) setStudySheetOpen(true);
    }
  }, [isAnalyzing, isAnalyzingSentences, isMobile, handleOpenPanel]);

  // ── Analyze selected words (streaming) ──
  const analysisAbortRef = useRef<AbortController | null>(null);

  const handleAnalyze = useCallback(async () => {
    const selectedKeys = Object.keys(selectedWords);
    if (selectedKeys.length === 0) return;

    const apiKey = getProviderApiKey(selectedProvider);
    if (!apiKey) { setShowApiKeyModal(true); return; }

    const newKeys = selectedKeys.filter((key) => !wordAnalyses[key]);
    if (newKeys.length === 0) return;

    const groupMap = new Map<number, string[]>();
    for (const key of newKeys) {
      const [paraIdxStr, word] = key.split(':');
      const paraIdx = parseInt(paraIdxStr, 10);
      if (!groupMap.has(paraIdx)) groupMap.set(paraIdx, []);
      groupMap.get(paraIdx)!.push(word);
    }

    const entries: WordEntry[] = [];
    for (const [paraIdx, words] of groupMap) {
      const paragraph = paragraphs.find((p) => p.index === paraIdx);
      if (!paragraph) continue;
      entries.push({
        paragraph_index: paraIdx,
        words,
        sentence: paragraph.text,
        sentence_translation: translations[paraIdx] || null,
      });
    }
    if (entries.length === 0) return;
    if (!documentId) return;

    // Cancel any in-flight analysis
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = new AbortController();

    setAnalyzing(true);
    setAnalysisError(null);
    clearStreamingTexts();

    // Pre-populate placeholder entries so word cards appear immediately
    const totalNew = newKeys.length;
    const placeholders: WordAnalysisResult[] = [];
    for (const key of newKeys) {
      const [paraIdxStr, word] = key.split(':');
      placeholders.push({
        paragraph_index: parseInt(paraIdxStr, 10),
        word,
        phonetic: '',
        part_of_speech: '',
        definition: '',
        definition_zh: '',
        collocations: [],
        example_sentence: '',
        cognates: [],
        synonyms_antonyms: { synonyms: [] },
        base_form: '',
        plural_form: '',
        exam_tags: [],
        _pending: true,
      });
    }
    setWordAnalyses(placeholders);
    setAnalysisProgress({ completed: 0, total: totalNew });

    let completedCount = 0;

    try {
      await analyzeWordsStream(
        entries,
        documentId!,
        (batchResults) => {
          completedCount += batchResults.length;
          setWordAnalyses(batchResults);
          setAnalysisProgress({ completed: completedCount, total: totalNew });
        },
        (chunk) => {
          // Raw AI text arrived — append to each word in this batch
          for (const word of chunk.words) {
            const key = `${chunk.para_index}:${word.toLowerCase()}`;
            appendStreamingText(key, chunk.text);
          }
        },
        apiKey,
        selectedProvider,
        analysisAbortRef.current.signal
      );
      clearWordSelection();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        let detail = err?.message || '单词解析失败';
        // 中断/失败时明确列出仍未完成的单词 — 绝不静默丢失。
        // 用 getState() 取最新 store, 闭包里的 wordAnalyses 是发起时的快照。
        const latest = useDocumentStore.getState().wordAnalyses;
        const missing = newKeys.filter((key) => !latest[key]);
        if (missing.length > 0 && !detail.includes('未能解析')) {
          const names = missing.slice(0, 10).map((k) => k.split(':')[1]).join(', ');
          const more = missing.length > 10 ? ` 等 ${missing.length} 个` : '';
          detail = `${detail} 以下 ${missing.length} 个单词未完成: ${names}${more}`;
        }
        setAnalysisError(detail);
      }
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(null);
      clearStreamingTexts();
      // Clean up any remaining placeholder entries on abort/error
      removePendingWordAnalyses();
      analysisAbortRef.current = null;
    }
  }, [selectedWords, wordAnalyses, paragraphs, translations, documentId, selectedProvider, removePendingWordAnalyses, appendStreamingText, clearStreamingTexts]);

  // ── Analyze selected sentences (streaming) ──
  const sentenceAbortRef = useRef<AbortController | null>(null);

  // ── 卸载时中止进行中的单词/句子分析流：离开页面后不再向 store 写入 ──
  useEffect(() => {
    return () => {
      analysisAbortRef.current?.abort();
      sentenceAbortRef.current?.abort();
    };
  }, []);

  const handleAnalyzeSentences = useCallback(async () => {
    const selectedKeys = Object.keys(selectedSentences);
    if (selectedKeys.length === 0) return;

    const apiKey = getProviderApiKey(selectedProvider);
    if (!apiKey) { setShowApiKeyModal(true); return; }

    const newKeys = selectedKeys.filter((key) => !sentenceAnalyses[key]);
    if (newKeys.length === 0) return;

    const entries: SentenceEntry[] = [];
    for (const key of newKeys) {
      const [paraIdxStr, sentIdxStr] = key.split(':');
      const paraIdx = parseInt(paraIdxStr, 10);
      const sentIdx = parseInt(sentIdxStr, 10);
      const selection = selectedSentences[key];
      if (!selection) continue;
      entries.push({
        paragraph_index: paraIdx,
        sentence_index: sentIdx,
        sentence_text: selection.text,
        sentence_translation: translations[paraIdx] || null,
      });
    }
    if (entries.length === 0) return;
    if (!documentId) return;

    // Cancel any in-flight sentence analysis
    sentenceAbortRef.current?.abort();
    sentenceAbortRef.current = new AbortController();

    setAnalyzingSentences(true);
    setSentenceAnalysisError(null);
    clearSentenceStreamingTexts();

    // Pre-populate placeholder entries so sentence cards appear immediately
    const placeholders: SentenceAnalysisResult[] = [];
    for (const key of newKeys) {
      const [paraIdxStr, sentIdxStr] = key.split(':');
      const selection = selectedSentences[key];
      if (!selection) continue;
      placeholders.push({
        paragraph_index: parseInt(paraIdxStr, 10),
        sentence_index: parseInt(sentIdxStr, 10),
        sentence_text: selection.text,
        content: '',
        _pending: true,
      });
    }
    setSentenceAnalyses(placeholders);

    try {
      await analyzeSentencesStream(
        entries,
        documentId,
        (batchResults) => {
          setSentenceAnalyses(batchResults);
        },
        (chunk) => {
          // Raw AI text arrived — append to the sentence's streaming display
          const key = `${chunk.para_index}:${chunk.sentence_index}`;
          appendSentenceStreamingText(key, chunk.text);
        },
        apiKey,
        selectedProvider,
        sentenceAbortRef.current.signal
      );
      clearSentenceSelection();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        let detail = err?.message || '句子解析失败';
        // 中断/失败时明确提示未完成的句子数量
        const latest = useDocumentStore.getState().sentenceAnalyses;
        const missing = newKeys.filter((key) => !latest[key]);
        if (missing.length > 0 && !detail.includes('未能解析')) {
          detail = `${detail} 以下 ${missing.length} 个句子未完成`;
        }
        setSentenceAnalysisError(detail);
      }
    } finally {
      setAnalyzingSentences(false);
      clearSentenceStreamingTexts();
      sentenceAbortRef.current = null;
    }
  }, [selectedSentences, sentenceAnalyses, translations, documentId, selectedProvider, appendSentenceStreamingText, clearSentenceStreamingTexts]);

  // ── Loading / empty states ──
  if (loading && !parseStatus) {
    return (
      <div className="flex items-center justify-center min-h-screen transition-colors duration-300" style={{ ...bgAdaptiveStyle, backgroundColor: bgColorValue }}>
        <Spinner label="加载文档..." />
      </div>
    );
  }

  if (parseStatus === 'pending' || parseStatus === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 animate-fade-in" style={{ backgroundColor: bgColorValue }}>
        <Spinner size="lg" />
        <p className="text-base text-muted">正在解析 PDF，请稍候...</p>
        <Button variant="ghost" onClick={() => navigate('/')}>返回首页</Button>
      </div>
    );
  }

  if (parseStatus === 'awaiting_selection') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 animate-fade-in" style={{ backgroundColor: bgColorValue }}>
        <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink">解析前需要选择页面</h3>
        <p className="text-muted max-w-sm text-center">该文档尚未选择解析范围，请先完成选页。</p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => navigate(`/?resume=${id}`)}>
            去选择页面
          </Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 animate-fade-in" style={{ backgroundColor: bgColorValue }}>
        <div className="w-16 h-16 rounded-full bg-error/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink">加载失败</h3>
        <p className="text-muted max-w-sm text-center">{error}</p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => { setError(null); setLoading(true); setParseStatus(''); window.location.reload(); }}>
            重试
          </Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  if (!loading && paragraphs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 animate-fade-in" style={{ backgroundColor: bgColorValue }}>
        <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink">文档内容为空</h3>
        <p className="text-muted max-w-sm text-center">
          PDF 解析未提取到文本内容，可能是扫描版 PDF 或图片格式
        </p>
        <Button variant="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden transition-colors duration-300" style={{ ...bgAdaptiveStyle, backgroundColor: bgColorValue }}>
      <ReaderHeader onOpenQa={handleOpenQa} />

      {/* ── Desktop: horizontal split layout ── */}
      {!isMobile && (
        <div className="flex-1 min-h-0 flex overflow-hidden transition-colors duration-300" style={{ backgroundColor: bgColorValue }}>
          {/* Left: Reading area */}
          <div
            className={`overflow-y-auto flex-shrink-0 min-h-0 ${panelJustOpened ? '' : 'transition-[width] duration-300 ease-out'}`}
            style={{ width: panelVisible && panelOpen ? leftWidth : '100%', backgroundColor: bgColorValue }}
          >
            <div className={panelVisible && panelOpen ? 'px-6 py-6 max-w-none' : 'px-8 py-6 max-w-[950px] mx-auto'}>
              {readingAreaContent}
            </div>
          </div>

          {/* Resizable divider */}
          {panelVisible && panelOpen && (
            <div
              className={`resize-handle ${isDragging ? '!bg-primary' : ''}`}
              onMouseDown={handleDividerMouseDown}
              onTouchStart={handleDividerTouchStart}
            />
          )}

          {/* Right: Study / QA panel（始终挂载，通过 transform/opacity 滑动进出） */}
          {panelVisible && (
            <div
              className={`flex-1 min-h-0 overflow-hidden flex flex-col transition-all duration-300 ease-out ${panelOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}
            >
              {activePanel === 'qa' ? (
                <QAPanel
                  onClose={() => setPanelOpen(false)}
                  onSwitchToStudy={handleSwitchToStudy}
                  apiKey={apiKey}
                  provider={selectedProvider}
                  onRequireApiKey={() => setShowApiKeyModal(true)}
                />
              ) : (
                <StudyPanel onClose={() => setPanelOpen(false)} onSwitchToQa={handleSwitchToQa} />
              )}
            </div>
          )}

          {/* Reopen panel button — shown when panel is closed but has analyses */}
          {panelVisible && !panelOpen && (
            <button
              onClick={activePanel === 'qa' ? handleOpenQa : handleOpenPanel}
              className="fixed right-3 top-1/2 -translate-y-1/2 z-40 w-9 h-24 bg-reader-surface border border-reader-line-soft rounded-l-xl shadow-soft flex flex-col items-center justify-center gap-1.5 hover:brightness-[0.96] transition-all touch-area group"
              title={activePanel === 'qa' ? '打开 AI 问答' : '打开解析面板'}
              style={{ borderRight: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span className="text-[10px] text-muted-soft font-medium leading-tight text-center group-hover:text-primary transition-colors">
                {activePanel === 'qa' ? (<>AI<br/>问答</>) : (<>解析<br/>面板</>)}
              </span>
            </button>
          )}
        </div>
      )}

      {/* ── Mobile: single column layout ── */}
      {isMobile && (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ backgroundColor: bgColorValue }}>
          <div className="px-4 py-4 max-w-none">
            {readingAreaContent}
          </div>
        </div>
      )}

      {/* ── Mobile: Study / QA panel bottom sheet ── */}
      {isMobile && (hasAnalyses || studySheetOpen) && (
        <StudySheet
          open={studySheetOpen}
          onClose={() => setStudySheetOpen(false)}
          topBar={
            <PanelSwitch
              active={activePanel}
              onChange={(v) => (v === 'qa' ? handleSwitchToQa() : handleSwitchToStudy())}
            />
          }
        >
          {activePanel === 'qa' ? (
            <QAPanel
              mobile
              onSwitchToStudy={handleSwitchToStudy}
              apiKey={apiKey}
              provider={selectedProvider}
              onRequireApiKey={() => {
                setStudySheetOpen(false);
                setShowApiKeyModal(true);
              }}
            />
          ) : (
            <StudyPanel mobile onSwitchToQa={handleSwitchToQa} />
          )}
        </StudySheet>
      )}

      {/* ── Mobile: Focused analysis sheet (tap analyzed word/sentence) ── */}
      {isMobile && focusedAnalysis && (
        <FocusedAnalysisSheet
          type={focusedAnalysis.type}
          analysisKey={focusedAnalysis.key}
          onClose={() => setFocusedAnalysis(null)}
        />
      )}

      {/* ── Mobile: FAB for AI 问答 ── */}
      {isMobile && !studySheetOpen && !focusedAnalysis && (
        <button
          onClick={handleOpenQa}
          className="fixed bottom-24 right-4 z-40 w-12 h-12 rounded-full bg-reader-surface border border-reader-line-soft text-primary shadow-pop flex items-center justify-center hover:brightness-[0.96] transition-colors touch-area"
          aria-label="打开 AI 问答"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      )}

      {/* ── Mobile: FAB for study panel ── */}
      {isMobile && hasAnalyses && !studySheetOpen && !focusedAnalysis && (
        <button
          onClick={() => {
            setActivePanel('study');
            setStudySheetOpen(true);
          }}
          className="fixed bottom-6 right-4 z-40 w-12 h-12 rounded-full bg-primary text-white shadow-pop flex items-center justify-center hover:bg-primary-active transition-colors touch-area"
          aria-label="打开解析面板"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 20V10M18 20V4M6 20v-4" />
          </svg>
        </button>
      )}

      {/* Floating action bar */}
      {(selectedWordCount > 0 || selectedSentenceCount > 0) && (
        <div className={[
          'z-50 rounded-xl px-4 md:px-5 py-3 border border-reader-line-soft shadow-pop flex items-center gap-3 md:gap-4 flex-wrap',
          isMobile
            ? 'fixed bottom-0 left-0 right-0 rounded-t-xl'
            : 'fixed bottom-6 left-1/2 -translate-x-1/2',
        ].join(' ')} style={{ backgroundColor: bgColorValue }}>
          {selectedWordCount > 0 && (
            <>
              <span className="text-sm text-body">
                已选 <strong className="text-body-strong">{selectedWordCount}</strong> 个单词
              </span>
              <Button variant="primary" size="sm" loading={isAnalyzing} onClick={handleAnalyze}>
                解析
              </Button>
              <Button variant="ghost" size="sm" onClick={clearWordSelection}>
                清除
              </Button>
            </>
          )}
          {selectedWordCount > 0 && selectedSentenceCount > 0 && (
            <div className="w-px h-6 bg-reader-line hidden md:block" />
          )}
          {selectedSentenceCount > 0 && (
            <>
              <span className="text-sm text-body">
                已选 <strong className="text-body-strong">{selectedSentenceCount}</strong> 个句子
              </span>
              <Button variant="primary" size="sm" loading={isAnalyzingSentences} onClick={handleAnalyzeSentences}>
                解析句子
              </Button>
              <Button variant="secondary" size="sm" onClick={handleAskAi}>
                问 AI
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSentenceSelection}>
                清除
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── 朗读播放条 ── */}
      {playerStatus !== 'idle' && <AudioPlayerBar />}

      <ApiKeyModal
        open={showApiKeyModal}
        onClose={() => {
          setShowApiKeyModal(false);
          setSelectedProvider(getStoredAIProvider());
          setTranslationTrigger((n) => n + 1);
        }}
      />
    </div>
  );
}
