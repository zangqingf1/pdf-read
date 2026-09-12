"""通用进程内滑动窗口限流（按用户 + 作用域计数）。

为什么需要它：AI（DeepSeek）与 PDF 导出各自只有一个**进程级全局并发信号量**
（`ai_service` 的 `AI_CONCURRENCY`=15、`export_service` 的 `PDF_EXPORT_CONCURRENCY`=2）。
没有按用户限流时，单个已登录用户开几个携带超大列表的请求就能占满全部槽位，
让其他所有用户的翻译/解析/问答/导出一起排队 —— 属于跨租户可用性问题。

设计取舍与仓库现有的 `app/auth/rate_limit.py`、`app/api/v1/tts.py` 保持一致：
状态在进程内（部署假设单 uvicorn worker），不引入 Redis 依赖。多副本部署需要
跨进程限流时再替换为 Redis 实现。
"""

import time
from collections import deque

from fastapi import HTTPException

# key = f"{scope}:{user_id}" -> deque of request timestamps (epoch seconds)
_buckets: dict[str, deque[float]] = {}
_WINDOW_SECONDS = 60.0
_MAX_TRACKED_KEYS = 10000


def enforce_user_limit(
    user_id: str,
    scope: str,
    limit: int,
    *,
    window_seconds: float = _WINDOW_SECONDS,
) -> None:
    """记一次请求；超过 ``limit`` 次/窗口时抛 429。

    ``scope`` 区分不同配额桶（如 ``ai`` / ``export`` / ``syllabus``），
    否则同一用户在不同功能间会互相吃掉额度。
    """
    if limit <= 0:  # 0 或负数视为关闭限制
        return
    now = time.time()
    key = f"{scope}:{user_id}"
    bucket = _buckets.get(key)
    if bucket is None:
        bucket = deque()
        _buckets[key] = bucket
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= limit:
        retry_in = max(1, int(bucket[0] + window_seconds - now))
        raise HTTPException(
            status_code=429,
            detail=f"操作过于频繁，请 {retry_in} 秒后重试。",
        )
    bucket.append(now)
    _cleanup_if_needed(now, window_seconds)


def _cleanup_if_needed(now: float, window_seconds: float) -> None:
    """机会式清理，避免长期运行后 dict 无限增长。"""
    if len(_buckets) <= _MAX_TRACKED_KEYS:
        return
    for key in list(_buckets.keys()):
        bucket = _buckets.get(key)
        if not bucket or now - bucket[-1] > window_seconds:
            _buckets.pop(key, None)


def reset_rate_limits() -> None:
    """清空全部计数（测试用，保证用例之间互不影响）。"""
    _buckets.clear()
