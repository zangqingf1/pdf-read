import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadPDF, getPDFStatus, selectPages, parseUrl } from '../../services/pdfApi';
import { getStoredMineruToken } from '../common/ApiKeyModal';
import PageSelector from './PageSelector';
import Button from '../ui/Button';

type UploadPhase = 'idle' | 'uploading' | 'selection' | 'parsing' | 'completed' | 'failed';

/** MinerU 支持的上传扩展名白名单（与后端 SUPPORTED_UPLOAD_EXTENSIONS 保持一致） */
const SUPPORTED_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.jp2,.webp,.gif,.bmp,.html';
const SUPPORTED_EXTS = new Set(SUPPORTED_ACCEPT.split(','));

interface PDFUploaderProps {
  resumeTaskId?: string | null;
  onResumed?: () => void;
  onDocumentChanged?: () => void;
  onSelectionChange?: (selecting: boolean) => void;
  /** 缺少 MinerU Token 时打开 API 配置弹窗 */
  onRequireApiKey?: (notice: string) => void;
}

const TOKEN_MISSING_MSG = 'MinerU API Token 未配置，请先填写 Token 后再解析文档';

export default function PDFUploader({
  resumeTaskId,
  onResumed,
  onDocumentChanged,
  onSelectionChange,
  onRequireApiKey,
}: PDFUploaderProps) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseError, setParseError] = useState<string>('');
  const [pageCount, setPageCount] = useState<number>(0);
  const [docTitle, setDocTitle] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 解析全程依赖 MinerU Token，缺失时后台任务只会以「解析失败」收场。
   * 所以在上传/选页之前先校验：通过返回 token，否则内联提示并打开 API 配置弹窗。
   */
  const requireMineruToken = useCallback((): string | null => {
    const token = getStoredMineruToken().trim();
    if (!token) {
      setFormError(TOKEN_MISSING_MSG);
      onRequireApiKey?.(TOKEN_MISSING_MSG);
      return null;
    }
    setFormError('');
    return token;
  }, [onRequireApiKey]);

  // Notify parent when entering/leaving selection phase
  useEffect(() => {
    onSelectionChange?.(phase === 'selection');
  }, [phase, onSelectionChange]);

  // Resume from an existing document
  useEffect(() => {
    if (!resumeTaskId) return;
    const resume = async () => {
      try {
        const status = await getPDFStatus(resumeTaskId);
        if (status.status === 'awaiting_selection' && status.page_count) {
          setTaskId(resumeTaskId);
          setPageCount(status.page_count);
          setPhase('selection');
          onResumed?.();
        }
      } catch { /* silent */ }
    };
    resume();
  }, [resumeTaskId]);

  // Poll for parsing status
  useEffect(() => {
    if (phase !== 'parsing' || !taskId) return;
    const poll = async () => {
      try {
        const result = await getPDFStatus(taskId);
        if (result.status === 'completed') {
          setParseProgress(100);
          setPhase('completed');
          onDocumentChanged?.();
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (result.status === 'failed') {
          setParseError(result.error || '文档解析失败');
          setPhase('failed');
          onDocumentChanged?.();
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setParseProgress((prev) => Math.min(prev + 5, 90));
        }
      } catch { /* ignore polling errors */ }
    };
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase, taskId]);

  const handleFile = useCallback(async (file: File) => {
    const token = requireMineruToken();
    if (!token) return;

    setPhase('uploading');
    setParseProgress(0);
    setDocTitle(file.name.replace(/\.[^.]+$/, ''));

    try {
      const result = await uploadPDF(file, token);
      setTaskId(result.task_id);

      if (result.status === 'awaiting_selection' && result.page_count != null) {
        setPageCount(result.page_count);
        setPhase('selection');
      } else {
        setPhase('parsing');
      }
      onDocumentChanged?.();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.detail || '上传失败，请重试';
      setFormError(errorMsg);
      setPhase('idle');
    }
  }, [requireMineruToken]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        const dot = file.name.lastIndexOf('.');
        const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
        if (SUPPORTED_EXTS.has(ext)) {
          handleFile(file);
          return;
        }
      }
      setFormError('请上传支持的文件（PDF、Word、PPT、Excel、图片或 HTML）');
    },
    [handleFile]
  );

  const handleUrlSubmit = useCallback(async () => {
    const url = urlInput.trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      setFormError('请输入以 http:// 或 https:// 开头的链接');
      return;
    }
    const token = requireMineruToken();
    if (!token) return;

    setPhase('uploading');
    setParseProgress(0);
    setDocTitle(url.replace(/^https?:\/\//i, '').split('/')[0]);
    try {
      const result = await parseUrl(url, token);
      setTaskId(result.task_id);
      setPhase('parsing');
      onDocumentChanged?.();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.detail || '链接解析失败，请重试';
      setFormError(errorMsg);
      setPhase('idle');
    }
  }, [urlInput, requireMineruToken]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleFile]
  );

  const handlePageSelection = useCallback(
    async (pages: number[]) => {
      if (!taskId) return;
      const token = requireMineruToken();
      if (!token) return;
      setPhase('parsing');
      setParseProgress(0);
      try {
        await selectPages({
          task_id: taskId,
          selected_pages: pages,
          mineru_token: token,
        });
        onDocumentChanged?.();
      } catch (err: any) {
        const errorMsg = err?.response?.data?.detail || '页面选择失败';
        setParseError(errorMsg);
        setPhase('failed');
      }
    },
    [taskId, requireMineruToken]
  );

  const handleSkipSelection = useCallback(async () => {
    if (!taskId) return;
    const token = requireMineruToken();
    if (!token) return;
    setPhase('parsing');
    setParseProgress(0);
    try {
      await selectPages({
        task_id: taskId,
        selected_pages: null,
        mineru_token: token,
      });
      onDocumentChanged?.();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.detail || '页面选择失败';
      setParseError(errorMsg);
      setPhase('failed');
    }
  }, [taskId, requireMineruToken]);

  const handleReset = () => {
    setPhase('idle');
    setTaskId(null);
    setParseProgress(0);
    setDocTitle('');
    setPageCount(0);
    setUrlInput('');
    setFormError('');
    setParseError('');
  };

  // ── Page Selection Phase ──
  if (phase === 'selection' && taskId) {
    return (
      <PageSelector
        taskId={taskId}
        pageCount={pageCount}
        onSubmit={handlePageSelection}
        onSkip={handleSkipSelection}
        onCancel={handleReset}
      />
    );
  }

  // ── Completed State ──
  if (phase === 'completed' && taskId) {
    return (
      <div className="h-[280px] bg-surface-overlay border border-hairline-soft rounded-xl shadow-soft px-6 py-6 text-center flex flex-col items-center justify-center">
        <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-success/15 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink mb-1">文档解析完成！</h3>
        <p className="text-muted text-[13px] mb-4">
          文档 <strong className="text-body-strong">{docTitle}</strong> 已准备就绪
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
          <Button variant="primary" size="sm" onClick={() => navigate(`/review/${taskId}`)}>
            审阅与编辑
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/document/${taskId}`)}>
            直接开始阅读
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            上传其他文档
          </Button>
        </div>
      </div>
    );
  }

  // ── Failed State ──
  if (phase === 'failed') {
    return (
      <div className="bg-surface-overlay border border-hairline-soft rounded-xl shadow-soft px-6 py-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-error/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink mb-2">文档解析失败</h3>
        <p className="text-muted mb-6">{parseError || '请检查文件格式后重试'}</p>
        <Button variant="primary" onClick={handleReset}>
          重新上传
        </Button>
      </div>
    );
  }

  // ── Idle / Uploading / Parsing State ──
  const isBusy = phase === 'uploading' || phase === 'parsing';

  const renderTab = (mode: 'file' | 'url', label: string) => (
    <button
      type="button"
      onClick={() => setInputMode(mode)}
      className={[
        'relative px-1 py-3 text-[13px] transition-colors',
        inputMode === mode
          ? 'font-semibold text-ink'
          : 'font-medium text-muted hover:text-body',
      ].join(' ')}
    >
      {label}
      {inputMode === mode && (
        <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-primary rounded-full" />
      )}
    </button>
  );

  // ── Busy: 只显示进度，不展示上传区域 ──
  if (isBusy) {
    return (
      <div className="bg-surface-overlay border border-hairline-soft rounded-xl shadow-soft p-5 animate-fade-in">
        <div className="flex items-center gap-3 mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <span className="text-sm font-medium text-body-strong">
            {phase === 'uploading' ? '正在上传文件...' : '正在解析文档正文...'}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-surface-card rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${parseProgress}%` }}
          />
        </div>

        <p className="text-xs text-muted mt-2">
          {phase === 'uploading'
            ? '上传中...'
            : '正在进行版面分析，提取正文内容，过滤页眉页脚和广告...'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface-overlay border border-hairline-soft rounded-xl shadow-soft overflow-hidden">
      {/* 配置/接口错误提示（toast 未接入，错误必须内联可见） */}
      {formError && (
        <div className="flex items-start gap-2 px-6 md:px-8 py-2.5 bg-error/10 border-b border-error/20 text-[13px] text-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{formError}</span>
        </div>
      )}

      {/* Tab 头：上传文件 / 粘贴链接 */}
      <div className="flex items-center gap-7 px-6 md:px-8 border-b border-hairline-soft">
        {renderTab('file', '上传文件')}
        {renderTab('url', '粘贴链接')}
      </div>

      <div className="p-4 md:p-6">
        {inputMode === 'file' ? (
          /* Upload Zone */
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !isBusy && fileInputRef.current?.click()}
            className={[
              'upload-zone flex flex-col items-center justify-center py-8 md:py-10 px-6 rounded-lg border border-dashed cursor-pointer transition-colors animate-fade-in',
              dragOver ? 'upload-zone-dragover' : 'border-hairline-strong bg-canvas/60',
              isBusy ? 'opacity-50 pointer-events-none' : 'hover:border-primary/50 hover:bg-canvas',
            ].join(' ')}
          >
            {/* Upload icon */}
            <div className="w-12 h-12 mb-3.5 rounded-full bg-primary/10 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-ink mb-1">
              点击或拖拽文件到此区域上传
            </p>
            <p className="text-[13px] text-muted">
              支持 PDF、Word、PPT、Excel、图片与 HTML，最大 50MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_ACCEPT}
              className="hidden"
              onChange={handleInputChange}
            />
          </div>
        ) : (
          /* URL Zone */
          <div className="py-1">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy) handleUrlSubmit(); }}
                placeholder="https:// 粘贴文件或网页链接"
                disabled={isBusy}
                className="flex-1 px-3.5 py-2 text-[13px] rounded-md border border-hairline bg-canvas/60 focus:outline-none focus:border-primary"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleUrlSubmit}
                disabled={isBusy || !urlInput.trim()}
              >
                解析链接
              </Button>
            </div>
            <p className="text-[13px] text-muted mt-2.5">
              支持文件链接（.pdf/.docx/.pptx/图片等）与网页文章链接，最大 50MB
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
