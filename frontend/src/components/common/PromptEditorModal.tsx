import { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import { TextArea } from '../ui/Input';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { usePromptStore } from '../../stores/promptStore';

// Placeholder descriptions for user guidance
const PLACEHOLDER_DESC: Record<string, string> = {
  text: '待翻译的英文段落',
  prev_text: '上一段（上下文，可能为空）',
  next_text: '下一段（上下文，可能为空）',
  words_list: '逗号分隔的单词列表',
  sentence: '包含目标单词的上下文句子',
  sentence_text: '待分析的完整英文句子',
  sentence_translation: '段落的中文翻译（或"无"）',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PromptEditorModal({ open, onClose }: Props) {
  const {
    templates,
    isLoading,
    isSaving,
    error,
    fetchTemplates,
    updateTemplate,
    resetTemplate,
  } = usePromptStore();

  const [editing, setEditing] = useState<Record<string, { system_prompt: string; user_prompt: string }>>({});
  const [resetConfirming, setResetConfirming] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchTemplates();
  }, [open, fetchTemplates]);

  useEffect(() => {
    const init: Record<string, { system_prompt: string; user_prompt: string }> = {};
    templates.forEach((t) => {
      init[t.name] = { system_prompt: t.system_prompt, user_prompt: t.user_prompt };
    });
    setEditing(init);
  }, [templates]);

  const handleFieldChange = (
    name: string,
    field: 'system_prompt' | 'user_prompt',
    value: string
  ) => {
    setEditing((prev) => ({
      ...prev,
      [name]: { ...prev[name], [field]: value },
    }));
  };

  const handleSaveAndClose = async () => {
    const t = templates[0];
    if (!t) return;
    const current = editing[t.name];
    if (!current) return;
    await updateTemplate(t.name, {
      system_prompt: current.system_prompt,
      user_prompt: current.user_prompt,
    });
    setSaveMessage('句子解析提示词已保存');
    setTimeout(() => {
      setSaveMessage(null);
      onClose();
    }, 1200);
  };

  const handleReset = async (name: string) => {
    setResetConfirming(false);
    await resetTemplate(name);
    setSaveMessage('句子解析提示词已重置为默认值');
    setTimeout(() => setSaveMessage(null), 2000);
  };

  const template = templates[0];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 提示词配置 — 句子解析"
      width="720px"
      footer={
        <>
          {resetConfirming ? (
            <div className="flex items-center gap-2 mr-auto">
              <span className="text-xs text-error">确定重置为默认值？</span>
              <button
                className="px-2 py-0.5 text-xs font-medium text-error hover:bg-error/10 rounded"
                onClick={() => template && handleReset(template.name)}
              >
                确定重置
              </button>
              <button
                className="px-2 py-0.5 text-xs text-muted hover:bg-surface-card rounded"
                onClick={() => setResetConfirming(false)}
              >
                取消
              </button>
            </div>
          ) : (
            <Button variant="danger" size="sm" loading={isSaving}
              onClick={() => setResetConfirming(true)}>
              重置为默认
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" loading={isSaving} onClick={handleSaveAndClose}>
            {saveMessage || '保存'}
          </Button>
        </>
      }
    >
      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error">
          {error}
        </div>
      )}

      {/* Info about placeholders */}
      <div className="mb-4 p-3 bg-canvas-soft border border-hairline rounded-md text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          占位符使用 <code className="bg-surface-card px-1 py-0.5 rounded text-xs font-mono">{'{变量名}'}</code> 语法，
          不要删除或修改占位符。点击「保存」生效；点击「重置」恢复默认。
        </span>
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {!isLoading && template && editing[template.name] ? (
        <div className="space-y-4">
          {/* User Prompt */}
          <div>
            <label className="text-sm font-medium text-body-strong block mb-2">
              User Prompt（必填 — 主指令，含占位符）
            </label>
            <TextArea
              value={editing[template.name].user_prompt}
              onChange={(e) => handleFieldChange(template.name, 'user_prompt', e.target.value)}
              placeholder="必填。包含 {占位符} 的主指令内容。"
              rows={8}
              maxLength={10000}
              className="font-mono !text-xs"
            />
            <span className="text-xs text-muted-soft mt-1 block">
              {editing[template.name].user_prompt.length} / 10000
            </span>
          </div>

          {/* Placeholders */}
          <div>
            <span className="text-xs text-muted mb-2 block font-medium">可用占位符</span>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {template.placeholders.map((ph) => (
                <Badge key={ph}>{`{${ph}}`}</Badge>
              ))}
            </div>
            <div className="space-y-0.5">
              {template.placeholders.map((ph) => (
                <span key={ph} className="block text-xs text-muted-soft">
                  <code className="text-xs font-mono bg-surface-card px-1 rounded">{`{${ph}}`}</code>
                  {' — '}{PLACEHOLDER_DESC[ph] || ph}
                </span>
              ))}
            </div>
          </div>

          {template.is_customized && (
            <p className="text-xs text-muted">
              当前使用自定义提示词
              {template.updated_at && `（最后更新：${new Date(template.updated_at).toLocaleString()}）`}
            </p>
          )}
        </div>
      ) : !isLoading && (
        <p className="text-sm text-muted">暂无提示词数据</p>
      )}
    </Modal>
  );
}
