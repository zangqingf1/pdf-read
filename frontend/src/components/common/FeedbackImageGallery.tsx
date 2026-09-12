import { useEffect, useRef, useState } from 'react';
import Spinner from '../ui/Spinner';
import { extractFeedbackError, fetchFeedbackImageUrl } from '../../services/feedbackApi';

interface FeedbackImageGalleryProps {
  feedbackId: number;
  /** 截图张数（来自后端 image_count） */
  count: number;
}

/**
 * 反馈截图查看器：主图 + 缩略图条。
 *
 * 截图端点需要鉴权，只能逐张取回 blob；这里按当前索引懒加载并缓存，
 * 同一张不会重复请求。blob URL 在组件卸载时统一释放。
 * 调用方请用 `key={feedbackId}` 挂载，避免切换反馈时复用旧缓存。
 */
export default function FeedbackImageGallery({
  feedbackId,
  count,
}: FeedbackImageGalleryProps) {
  const [current, setCurrent] = useState(0);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 缓存放进 ref：卸载时用它释放全部 blob URL
  const urlsRef = useRef<Record<number, string>>({});

  useEffect(() => {
    return () => {
      Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (urls[current]) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchFeedbackImageUrl(feedbackId, current)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        urlsRef.current[current] = url;
        setUrls((prev) => ({ ...prev, [current]: url }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractFeedbackError(err, '截图加载失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feedbackId, current, urls]);

  const currentUrl = urls[current];

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-canvas border border-hairline rounded-md min-h-[160px] flex items-center justify-center p-2">
        {loading && !currentUrl ? (
          <Spinner size="md" label="加载截图中..." />
        ) : error ? (
          <p className="text-sm text-error py-8">{error}</p>
        ) : currentUrl ? (
          <img
            src={currentUrl}
            alt={`截图 ${current + 1}`}
            className="max-w-full max-h-[60vh] object-contain"
          />
        ) : null}
      </div>

      {count > 1 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrent(i)}
              className={`w-14 h-14 rounded-md border overflow-hidden flex items-center justify-center text-xs transition-all duration-150 ${
                current === i
                  ? 'border-primary text-primary font-medium'
                  : 'border-hairline text-muted hover:border-muted-soft'
              }`}
              title={`第 ${i + 1} 张`}
            >
              {urls[i] ? (
                <img src={urls[i]} alt={`缩略图 ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                i + 1
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
