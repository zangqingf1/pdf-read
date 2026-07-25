import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadPDF, getPDFStatus, selectPages } from '../../services/pdfApi';
import { getStoredMineruToken } from '../common/ApiKeyModal';
import PageSelector from './PageSelector';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';

type UploadPhase = 'idle' | 'uploading' | 'selection' | 'parsing' | 'completed' | 'failed';

interface PDFUploaderProps {
  resumeTaskId?: string | null;
  onResumed?: () => void;
  onDocumentChanged?: () => void;
  onSelectionChange?: (selecting: boolean) => void;
}

/** Simple toast-like message — replaces antd message */
let toastMsg: ((msg: string) => void) | null = null;
export function setToast(fn: (msg: string) => void) { toastMsg = fn; }
function toast(msg: string) { toastMsg?.(msg); }

export default function PDFUploader({
  resumeTaskId,
  onResumed,
  onDocumentChanged,
  onSelectionChange,
}: PDFUploaderProps) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseStatus, setParseStatus] = useState<string>('');
  const [pageCount, setPageCount] = useState<number>(0);
  const [docTitle, setDocTitle] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const navigate = useNavigate();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  }, [resumeTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for parsing status
  useEffect(() => {
    if (phase !== 'parsing' || !taskId) return;
    const poll = async () => {
      try {
        const result = await getPDFStatus(taskId);
        setParseStatus(result.status);
        if (result.status === 'completed') {
          setParseProgress(100);
          setPhase('completed');
          onDocumentChanged?.();
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (result.status === 'failed') {
          toast(result.error || 'PDF 解析失败');
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
    setPhase('uploading');
    setParseProgress(0);
    setDocTitle(file.name.replace(/\.pdf$/i, ''));

    try {
      const result = await uploadPDF(file, getStoredMineruToken() || undefined);
      setTaskId(result.task_id);

      if (result.status === 'awaiting_selection' && result.page_count != null) {
        setPageCount(result.page_count);
        setPhase('selection');
      } else {
        setParseStatus('processing');
        setPhase('parsing');
      }
      onDocumentChanged?.();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.detail || '上传失败，请重试';
      toast(errorMsg);
      setPhase('idle');
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        handleFile(file);
      } else {
        toast('请上传 PDF 文件');
      }
    },
    [handleFile]
  );

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
      setPhase('parsing');
      setParseProgress(0);
      setParseStatus('processing');
      try {
        await selectPages({
          task_id: taskId,
          selected_pages: pages,
          mineru_token: getStoredMineruToken() || undefined,
        });
        onDocumentChanged?.();
      } catch (err: any) {
        const errorMsg = err?.response?.data?.detail || '页面选择失败';
        toast(errorMsg);
        setPhase('failed');
      }
    },
    [taskId]
  );

  const handleSkipSelection = useCallback(async () => {
    if (!taskId) return;
    setPhase('parsing');
    setParseProgress(0);
    setParseStatus('processing');
    try {
      await selectPages({
        task_id: taskId,
        selected_pages: null,
        mineru_token: getStoredMineruToken() || undefined,
      });
      onDocumentChanged?.();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.detail || '页面选择失败';
      toast(errorMsg);
      setPhase('failed');
    }
  }, [taskId]);

  const handleReset = () => {
    setPhase('idle');
    setTaskId(null);
    setParseProgress(0);
    setParseStatus('');
    setDocTitle('');
    setPageCount(0);
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
      <div className="text-center py-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink mb-2">PDF 解析完成！</h3>
        <p className="text-muted mb-8 max-w-sm mx-auto">
          文档 <strong className="text-body-strong">{docTitle}</strong> 已准备就绪
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button variant="primary" size="lg" onClick={() => navigate(`/review/${taskId}`)}>
            审阅与编辑
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate(`/document/${taskId}`)}>
            直接开始阅读
          </Button>
          <Button variant="ghost" onClick={handleReset}>
            上传其他文档
          </Button>
        </div>
      </div>
    );
  }

  // ── Failed State ──
  if (phase === 'failed') {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-error/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink mb-2">PDF 解析失败</h3>
        <p className="text-muted mb-6">{parseStatus || '请检查文件格式后重试'}</p>
        <Button variant="primary" onClick={handleReset}>
          重新上传
        </Button>
      </div>
    );
  }

  // ── Idle / Uploading / Parsing State ──
  const isBusy = phase === 'uploading' || phase === 'parsing';

  return (
    <div>
      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isBusy && fileInputRef.current?.click()}
        className={[
          'upload-zone flex flex-col items-center justify-center p-6 md:p-10 rounded-lg border-2 border-dashed cursor-pointer transition-colors',
          dragOver ? 'upload-zone-dragover' : 'border-hairline bg-surface-card',
          isBusy ? 'opacity-50 pointer-events-none' : '',
        ].join(' ')}
      >
        {/* Upload icon */}
        <div className="w-14 h-14 mb-4 rounded-full bg-canvas flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3" />
          </svg>
        </div>
        <p className="text-base text-body-strong mb-1">
          点击或拖拽 PDF 文件到此区域上传
        </p>
        <p className="text-sm text-muted">
          支持英文 PDF，最大 50MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* Progress */}
      {isBusy && (
        <div className="mt-6 p-5 bg-surface-card rounded-lg border border-hairline">
          <div className="flex items-center gap-3 mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <span className="text-sm font-medium text-body-strong">
              {phase === 'uploading' ? '正在上传文件...' : '正在解析 PDF 正文...'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-canvas rounded-full overflow-hidden">
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
      )}
    </div>
  );
}
