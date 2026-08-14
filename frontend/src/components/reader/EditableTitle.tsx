import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { updateDocumentTitle } from '../../services/pdfApi';

interface EditableTitleProps {
  /** 展示态 <h2> 的类名 */
  headingClassName?: string;
  /** 编辑态输入框的类名 */
  inputClassName?: string;
  /** 展示态 hover 提示（title 属性） */
  hint?: string;
  /** 标题为空时的兜底展示文案 */
  fallback?: string;
}

/**
 * 阅读页大标题：点击进入编辑（输入框自动聚焦并全选），Enter/失焦保存，Esc 取消。
 * 保存成功后更新 store 并清空旧的中文翻译（英文变更使其失效，随翻译流程自动重译）；
 * 保存失败保持编辑态并提示，空标题不允许保存。
 */
export default function EditableTitle({
  headingClassName = '',
  inputClassName = '',
  hint = '点击修改标题',
  fallback = 'Untitled Document',
}: EditableTitleProps) {
  const documentId = useDocumentStore((s) => s.documentId);
  const title = useDocumentStore((s) => s.title);
  const setTitle = useDocumentStore((s) => s.setTitle);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 防止 Enter 与失焦（保存中禁用输入框也会触发 blur）重复提交
  const committingRef = useRef(false);

  const display = title || fallback;

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(display);
    setError(null);
    setEditing(true);
  };

  const commit = async (fromBlur = false) => {
    if (committingRef.current || !editing) return;
    committingRef.current = true;
    try {
      const text = draft.trim();
      if (!text) {
        // 失焦（点击别处）= 隐式取消，还原标题；回车提交空标题 → 提示
        if (fromBlur) {
          setEditing(false);
        } else {
          setError('标题不能为空');
          inputRef.current?.focus();
        }
        return;
      }
      if (text === title) {
        setEditing(false);
        return;
      }
      if (!documentId) {
        setEditing(false);
        return;
      }
      setSaving(true);
      try {
        await updateDocumentTitle(documentId, text);
        setTitle(text);
        setEditing(false);
      } catch (err: any) {
        setError(err?.response?.data?.detail || err?.message || '保存失败，请重试');
        inputRef.current?.focus();
      } finally {
        setSaving(false);
      }
    } finally {
      committingRef.current = false;
    }
  };

  const cancelEditing = () => {
    setEditing(false);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit(false);
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col items-start">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => void commit(true)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          maxLength={500}
          className={[
            'w-full rounded-md border px-2 py-0.5 bg-canvas text-ink font-display',
            'focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)]',
            'border-primary/50',
            inputClassName,
          ].join(' ')}
          placeholder="输入标题…"
        />
        {error && <span className="mt-1 text-xs text-error">{error}</span>}
      </div>
    );
  }

  return (
    <h2
      onClick={startEditing}
      title={hint}
      className={['group cursor-text', headingClassName].join(' ')}
    >
      {display}
      <span className="ml-2 inline-flex items-center align-middle text-muted opacity-0 transition-opacity group-hover:opacity-70">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </span>
    </h2>
  );
}
