import { useEffect, useState } from 'react';
import { usePromptStore } from '../../stores/promptStore';
import { getDefaultPrompt, type PromptTemplate } from '../../services/promptApi';
import Button from '../../components/ui/Button';
import { TextArea } from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';

// Placeholder descriptions covering all three template types
const PLACEHOLDER_DESC: Record<string, string> = {
  text: '待翻译的英文段落',
  prev_text: '上一段（上下文，可能为空）',
  next_text: '下一段（上下文，可能为空）',
  words_list: '逗号分隔的单词列表',
  paragraph: '单词所在的完整段落原文',
  sentence: '段落原文（旧模板兼容占位符，与新段落模式等价）',
  sentence_text: '待分析的完整英文句子',
  sentence_translation: '段落或句子的中文翻译',
  sentences_text: '所有句子的完整文本',
  translations_text: '所有句子的翻译文本',
};

export default function AdminPrompts() {
  const {
    templates,
    isLoading,
    isSaving,
    error,
    fetchTemplates,
    updateTemplate,
    promoteTemplate,
    resetTemplate,
    resetAllTemplates,
  } = usePromptStore();

  // Edit modal state
  const [editTarget, setEditTarget] = useState<PromptTemplate | null>(null);
  const [editSystem, setEditSystem] = useState('');
  const [editUser, setEditUser] = useState('');
  const [editAsDefault, setEditAsDefault] = useState(false);
  const [defaultPrompt, setDefaultPrompt] = useState<PromptTemplate | null>(null);
  const [showDefault, setShowDefault] = useState(false);

  // Reset confirmation
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetAllConfirming, setResetAllConfirming] = useState(false);

  // Promote confirmation
  const [promoteTarget, setPromoteTarget] = useState<string | null>(null);

  // Success message
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  // ── Edit handlers ──
  const openEdit = async (tpl: PromptTemplate) => {
    setEditTarget(tpl);
    setEditSystem(tpl.system_prompt);
    setEditUser(tpl.user_prompt);
    setEditAsDefault(tpl.is_default);
    setShowDefault(false);
    try {
      const def = await getDefaultPrompt(tpl.name);
      setDefaultPrompt(def);
    } catch {
      setDefaultPrompt(null);
    }
  };

  const handleSave = async () => {
    if (!editTarget) return;
    await updateTemplate(
      editTarget.name,
      { system_prompt: editSystem, user_prompt: editUser },
      editAsDefault,
    );
    setEditTarget(null);
    const label = editAsDefault ? '系统默认' : '自定义';
    showSuccess(`${editTarget.display_name || editTarget.name} 已保存为${label}提示词`);
  };

  // ── Promote handler ──
  const handlePromote = async (name: string) => {
    setPromoteTarget(null);
    await promoteTemplate(name);
    const tpl = templates.find((t) => t.name === name);
    showSuccess(`${tpl?.display_name || name} 已提升为系统默认`);
  };

  // ── Reset handlers ──
  const handleResetSingle = async (name: string) => {
    setResetTarget(null);
    await resetTemplate(name);
    const tpl = templates.find((t) => t.name === name);
    showSuccess(`${tpl?.display_name || name} 已重置为出厂默认值`);
  };

  const handleResetAll = async () => {
    setResetAllConfirming(false);
    await resetAllTemplates();
    showSuccess('全部提示词已重置为出厂默认值');
  };

  // ── Status badge ──
  const statusBadge = (tpl: PromptTemplate) => {
    if (tpl.is_default) return <Badge variant="coral">系统默认</Badge>;
    if (tpl.is_customized) return <Badge variant="coral">已自定义</Badge>;
    return <Badge variant="default">出厂默认</Badge>;
  };

  const hasAnyModification = (tpl: PromptTemplate) =>
    tpl.is_customized || tpl.is_default;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-display-sm font-display text-ink">Prompt 管理</h2>
        <Button
          variant="danger"
          size="sm"
          loading={isSaving}
          onClick={() => setResetAllConfirming(true)}
        >
          重置全部为出厂默认
        </Button>
      </div>

      {/* Success toast */}
      {successMessage && (
        <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded-md text-sm text-primary font-medium">
          {successMessage}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="加载 Prompt 模板..." />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-error mb-4 text-sm">{error}</p>
          <Button variant="primary" size="sm" onClick={() => fetchTemplates()}>
            重试
          </Button>
        </div>
      ) : templates.length === 0 ? (
        <EmptyState title="暂无 Prompt 模板" description="请检查后端服务是否正常运行" />
      ) : (
        <>
          {/* ── Card grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {templates.map((tpl) => {
              const isResetBusy = resetTarget === tpl.name && isSaving;
              const isPromoteBusy = promoteTarget === tpl.name && isSaving;

              return (
                <div
                  key={tpl.name}
                  className="bg-canvas border border-hairline rounded-lg p-5 flex flex-col"
                >
                  {/* Title + status */}
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-display font-medium text-ink text-base">
                      {tpl.display_name || tpl.name}
                    </h3>
                    {statusBadge(tpl)}
                  </div>

                  <p className="text-xs text-muted-soft mb-3 font-mono">
                    {tpl.name}
                  </p>

                  {/* Updated time */}
                  {tpl.updated_at && (
                    <p className="text-xs text-muted mb-3">
                      最后更新：{new Date(tpl.updated_at).toLocaleString('zh-CN')}
                    </p>
                  )}

                  {/* Placeholders preview */}
                  <div className="mb-4 flex-1">
                    <p className="text-xs text-muted-soft mb-1.5">可用占位符：</p>
                    <div className="flex flex-wrap gap-1">
                      {tpl.placeholders.map((ph) => (
                        <Badge key={ph}>{`{${ph}}`}</Badge>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-3 border-t border-hairline flex-wrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => openEdit(tpl)}
                    >
                      编辑
                    </Button>

                    {/* Promote: only for custom (is_customized && !is_default) */}
                    {tpl.is_customized && !tpl.is_default && (
                      promoteTarget === tpl.name ? (
                        <div className="flex gap-1">
                          <button
                            className="px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded"
                            onClick={() => handlePromote(tpl.name)}
                            disabled={isPromoteBusy}
                          >
                            确定提升
                          </button>
                          <button
                            className="px-2 py-1 text-xs text-muted hover:bg-surface-card rounded"
                            onClick={() => setPromoteTarget(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="!text-primary hover:!bg-primary/10"
                          loading={isPromoteBusy}
                          onClick={() => setPromoteTarget(tpl.name)}
                          title="将当前自定义提示词提升为系统默认"
                        >
                          提升为默认
                        </Button>
                      )
                    )}

                    {/* Reset: available for any modified prompt */}
                    {hasAnyModification(tpl) && (
                      resetTarget === tpl.name ? (
                        <div className="flex gap-1">
                          <button
                            className="px-2 py-1 text-xs font-medium text-error hover:bg-error/10 rounded"
                            onClick={() => handleResetSingle(tpl.name)}
                            disabled={isResetBusy}
                          >
                            确定
                          </button>
                          <button
                            className="px-2 py-1 text-xs text-muted hover:bg-surface-card rounded"
                            onClick={() => setResetTarget(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="!text-error hover:!bg-error/10"
                          loading={isResetBusy}
                          onClick={() => setResetTarget(tpl.name)}
                        >
                          重置
                        </Button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Edit Modal ── */}
      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`编辑提示词 — ${editTarget?.display_name || editTarget?.name || ''}`}
        width="800px"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button variant="primary" loading={isSaving} onClick={handleSave}>
              保存
            </Button>
          </>
        }
      >
        {editTarget && (
          <div className="space-y-5">
            {/* Info */}
            <div className="p-3 bg-canvas-soft border border-hairline rounded-md text-sm text-muted">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                占位符使用 <code className="bg-surface-card px-1 py-0.5 rounded text-xs font-mono">{'{变量名}'}</code> 语法，
                不要删除或修改占位符。保存后立即生效。
              </span>
            </div>

            {/* Save-as toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editAsDefault}
                onChange={(e) => setEditAsDefault(e.target.checked)}
                className="w-4 h-4 rounded border-hairline text-primary focus:ring-primary/30"
              />
              <span className="text-sm text-body">
                保存为<strong>系统默认</strong>（所有用户默认使用此版本）
              </span>
            </label>

            {/* System Prompt */}
            <div>
              <label className="text-sm font-medium text-body-strong block mb-2">
                System Prompt（可选 — 角色/人格设定）
              </label>
              <TextArea
                value={editSystem}
                onChange={(e) => setEditSystem(e.target.value)}
                placeholder='可选。例如："你是一名专业翻译..."'
                rows={4}
                maxLength={5000}
                className="font-mono !text-xs"
              />
              <span className="text-xs text-muted-soft mt-1 block">
                {editSystem.length} / 5000
              </span>
            </div>

            {/* User Prompt */}
            <div>
              <label className="text-sm font-medium text-body-strong block mb-2">
                User Prompt（必填 — 主指令，含占位符）
              </label>
              <TextArea
                value={editUser}
                onChange={(e) => setEditUser(e.target.value)}
                placeholder="必填。包含 {占位符} 的主指令内容。"
                rows={10}
                maxLength={10000}
                className="font-mono !text-xs"
              />
              <span className="text-xs text-muted-soft mt-1 block">
                {editUser.length} / 10000
              </span>
            </div>

            {/* Placeholder reference */}
            <div>
              <span className="text-xs text-muted mb-2 block font-medium">可用占位符参考</span>
              <div className="space-y-1">
                {editTarget.placeholders.map((ph) => (
                  <span key={ph} className="block text-xs text-muted-soft">
                    <code className="text-xs font-mono bg-surface-card px-1 rounded">{`{${ph}}`}</code>
                    {' — '}{PLACEHOLDER_DESC[ph] || ph}
                  </span>
                ))}
              </div>
            </div>

            {/* Default prompt reference (collapsible) */}
            {defaultPrompt && (
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium mb-2"
                  onClick={() => setShowDefault(!showDefault)}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="1.5"
                    className={`transition-transform ${showDefault ? 'rotate-90' : ''}`}
                  >
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                  {showDefault ? '收起出厂默认模板' : '查看出厂默认模板（参考）'}
                </button>
                {showDefault && (
                  <div className="p-3 bg-canvas border border-hairline rounded-md space-y-3">
                    {defaultPrompt.system_prompt && (
                      <div>
                        <span className="text-xs text-muted-soft block mb-1">System Prompt（出厂默认）</span>
                        <p className="text-xs text-muted font-mono whitespace-pre-wrap">{defaultPrompt.system_prompt}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-xs text-muted-soft block mb-1">User Prompt（出厂默认）</span>
                      <p className="text-xs text-muted font-mono whitespace-pre-wrap">{defaultPrompt.user_prompt}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Reset All Confirmation Modal ── */}
      <Modal
        open={resetAllConfirming}
        onClose={() => setResetAllConfirming(false)}
        title="确认重置全部提示词"
        width="420px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setResetAllConfirming(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={isSaving}
              onClick={handleResetAll}
            >
              确认重置
            </Button>
          </>
        }
      >
        <p className="text-sm text-body">
          确定要将所有三个 Prompt 模板重置为出厂默认值吗？
        </p>
        <p className="text-sm text-muted mt-2">
          此操作将删除所有自定义修改和系统默认设置，不可撤销。
        </p>
      </Modal>
    </div>
  );
}
