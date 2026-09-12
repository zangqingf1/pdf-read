import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input, { TextArea } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import FeedbackImageGallery from '../components/common/FeedbackImageGallery';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_CONTENT,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_MB,
  FEEDBACK_MAX_TOTAL_MB,
  feedbackCategoryLabel,
  feedbackStatusMeta,
} from '../constants/feedback';
import {
  extractFeedbackError,
  getMyFeedback,
  submitFeedback,
  type FeedbackItem,
} from '../services/feedbackApi';

const PAGE_SIZE = 10;

/** 待提交的截图：File + 本地预览 blob URL（成对创建/释放） */
interface Attachment {
  file: File;
  url: string;
}

function formatDate(iso: string): string {
  if (!iso) return '--';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '--';
  }
}

export default function FeedbackPage() {
  const navigate = useNavigate();

  // 表单
  const [category, setCategory] = useState<string>(FEEDBACK_CATEGORIES[0].value);
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 卸载时统一释放预览 URL（state 在闭包里会过期，所以同步一份 ref）
  const attachmentsRef = useRef<Attachment[]>([]);

  // 我的反馈列表
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // 截图查看
  const [shotTarget, setShotTarget] = useState<FeedbackItem | null>(null);

  const loadList = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setListError('');
    try {
      const data = await getMyFeedback({ limit: PAGE_SIZE, offset: nextOffset });
      setItems(data.feedbacks);
      setTotal(data.total);
    } catch (err: unknown) {
      setListError(extractFeedbackError(err, '获取反馈记录失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList(offset);
  }, [offset, loadList, reloadKey]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.url));
    };
  }, []);

  const applyAttachments = (next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const clearAttachments = () => {
    attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.url));
    applyAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormError('');
    const picked = Array.from(e.target.files ?? []);
    // 清空 input，允许再次选择同一个文件
    e.target.value = '';
    if (picked.length === 0) return;

    const remaining = FEEDBACK_MAX_IMAGES - attachments.length;
    if (remaining <= 0) {
      setFormError(`最多上传 ${FEEDBACK_MAX_IMAGES} 张截图`);
      return;
    }

    const accepted: Attachment[] = [];
    const rejected: string[] = [];
    for (const file of picked.slice(0, remaining)) {
      if (!file.type.startsWith('image/')) {
        rejected.push(`${file.name} 不是图片文件`);
        continue;
      }
      if (file.size > FEEDBACK_MAX_IMAGE_MB * 1024 * 1024) {
        rejected.push(`${file.name} 超过 ${FEEDBACK_MAX_IMAGE_MB}MB`);
        continue;
      }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }

    const next = [...attachments, ...accepted];
    const totalBytes = next.reduce((sum, a) => sum + a.file.size, 0);
    if (totalBytes > FEEDBACK_MAX_TOTAL_MB * 1024 * 1024) {
      accepted.forEach((a) => URL.revokeObjectURL(a.url));
      setFormError(`截图总大小不能超过 ${FEEDBACK_MAX_TOTAL_MB}MB`);
      return;
    }

    applyAttachments(next);
    if (rejected.length > 0) {
      setFormError(rejected.join('；'));
    } else if (picked.length > remaining) {
      setFormError(`最多上传 ${FEEDBACK_MAX_IMAGES} 张，已添加前 ${remaining} 张`);
    }
  };

  const handleRemoveAttachment = (index: number) => {
    URL.revokeObjectURL(attachments[index].url);
    applyAttachments(attachments.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSuccess('');
    const text = content.trim();
    if (!text) {
      setFormError('请填写反馈内容');
      return;
    }
    setSubmitting(true);
    try {
      await submitFeedback({
        category,
        content: text,
        contact,
        images: attachments.map((a) => a.file),
      });
      setContent('');
      setContact('');
      clearAttachments();
      setSuccess('反馈已提交，我们会尽快处理并在此回复');
      setOffset(0);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setFormError(extractFeedbackError(err, '提交失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-muted hover:text-primary mb-6 inline-flex items-center gap-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
          返回
        </button>

        <h1 className="text-display-md font-display text-ink mb-2">问题反馈</h1>
        <p className="text-sm text-muted mb-6">
          遇到功能异常、内容问题或有改进建议，都可以在这里告诉我们。
        </p>

        {/* 提交表单 */}
        <form onSubmit={handleSubmit} className="bg-surface-card border border-hairline rounded-xl p-6 shadow-elevated flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-body-strong">反馈类型</span>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-all duration-150 ${
                    category === c.value
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <TextArea
            label="反馈内容 *"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="请描述遇到的问题或建议，越具体越好（例如：在哪个页面、做了什么操作、期望的结果）"
            rows={5}
            maxLength={FEEDBACK_MAX_CONTENT}
          />

          <Input
            label="联系方式（可选）"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="邮箱 / 微信，方便我们回访"
            maxLength={200}
          />

          {/* 截图（可多张） */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-body-strong">
              截图（可选，最多 {FEEDBACK_MAX_IMAGES} 张）
            </span>
            <div className="flex flex-col items-start gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={attachments.length >= FEEDBACK_MAX_IMAGES}
                onClick={() => fileInputRef.current?.click()}
              >
                {attachments.length > 0 ? '继续添加截图' : '选择截图'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <span className="text-xs text-muted-soft">
                单张 ≤{FEEDBACK_MAX_IMAGE_MB}MB、合计 ≤{FEEDBACK_MAX_TOTAL_MB}MB，支持 PNG / JPG / GIF / WebP
              </span>

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-1">
                  {attachments.map((a, i) => (
                    <div key={a.url} className="relative">
                      <img
                        src={a.url}
                        alt={`截图中预览 ${i + 1}`}
                        className="w-20 h-20 object-cover rounded-md border border-hairline"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(i)}
                        title="移除这张截图"
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink/70 text-white text-xs leading-none flex items-center justify-center hover:bg-error transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {formError && (
            <p className="text-sm text-error bg-error/5 border border-error/20 rounded-md px-3 py-2">
              {formError}
            </p>
          )}
          {success && (
            <p className="text-sm text-success bg-success/5 border border-success/20 rounded-md px-3 py-2">
              {success}
            </p>
          )}

          <Button type="submit" variant="primary" size="md" loading={submitting} className="w-full mt-1">
            提交反馈
          </Button>
        </form>

        {/* 我的反馈 */}
        <h2 className="text-lg font-display text-ink mt-10 mb-4">我的反馈</h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="加载反馈记录..." />
          </div>
        ) : listError ? (
          <div className="text-center py-12">
            <p className="text-error mb-4 text-sm">{listError}</p>
            <Button variant="primary" size="sm" onClick={() => void loadList(offset)}>
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="还没有提交过反馈" description="在上方填写并提交，我们会尽快回复" />
        ) : (
          <>
            <div className="space-y-3">
              {items.map((fb) => {
                const status = feedbackStatusMeta(fb.status);
                return (
                  <div key={fb.id} className="bg-surface-card border border-hairline rounded-lg p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="default">{feedbackCategoryLabel(fb.category)}</Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      <span className="text-xs text-muted-soft whitespace-nowrap">
                        {formatDate(fb.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-body whitespace-pre-wrap break-words">{fb.content}</p>
                    {fb.contact && (
                      <p className="text-xs text-muted-soft mt-2">联系方式：{fb.contact}</p>
                    )}
                    {fb.image_count > 0 && (
                      <button
                        type="button"
                        onClick={() => setShotTarget(fb)}
                        className="text-xs text-primary hover:underline mt-2"
                      >
                        查看截图（{fb.image_count}）
                      </button>
                    )}
                    {fb.admin_reply && (
                      <div className="mt-3 rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
                        <p className="text-xs font-medium text-primary mb-1">
                          管理员回复
                          {fb.replied_at ? ` · ${formatDate(fb.replied_at)}` : ''}
                        </p>
                        <p className="text-sm text-body whitespace-pre-wrap break-words">
                          {fb.admin_reply}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm text-muted">
                <span>
                  共 {total} 条，第 {currentPage} / {totalPages} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 截图查看 */}
      <Modal
        open={shotTarget !== null}
        onClose={() => setShotTarget(null)}
        title={`反馈截图（${shotTarget?.image_count ?? 0} 张）`}
        width="720px"
      >
        {shotTarget && (
          <FeedbackImageGallery
            key={shotTarget.id}
            feedbackId={shotTarget.id}
            count={shotTarget.image_count}
          />
        )}
      </Modal>
    </div>
  );
}
