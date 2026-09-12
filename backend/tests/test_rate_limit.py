"""测试按用户限流：滑动窗口语义 + 关键端点确实挂上了配额。

背景：AI 与导出各自只有一个进程级全局并发信号量，没有按用户限流时，单个用户
开几个大请求就能占满全部槽位、饿死其他用户（跨租户可用性问题）。
"""

import pytest
from fastapi import HTTPException

from app.api.deps import ai_rate_limit, export_rate_limit, syllabus_rate_limit
from app.utils import rate_limit as rate_limit_module
from app.utils.rate_limit import enforce_user_limit, reset_rate_limits


@pytest.fixture(autouse=True)
def _isolate():
    reset_rate_limits()
    yield
    reset_rate_limits()


def test_allows_up_to_limit_then_429():
    for i in range(3):
        enforce_user_limit("u1", "ai", 3)  # 前 3 次放行
    with pytest.raises(HTTPException) as exc:
        enforce_user_limit("u1", "ai", 3)
    assert exc.value.status_code == 429
    assert "秒后重试" in exc.value.detail


def test_scopes_and_users_are_independent():
    enforce_user_limit("u1", "ai", 1)
    # 同一用户的其他作用域不受影响
    enforce_user_limit("u1", "export", 1)
    # 其他用户不受影响
    enforce_user_limit("u2", "ai", 1)
    with pytest.raises(HTTPException):
        enforce_user_limit("u1", "ai", 1)


def test_zero_limit_disables_enforcement():
    for _ in range(50):
        enforce_user_limit("u1", "ai", 0)


def test_window_slides(monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: clock["t"])
    enforce_user_limit("u1", "ai", 2)
    enforce_user_limit("u1", "ai", 2)
    with pytest.raises(HTTPException):
        enforce_user_limit("u1", "ai", 2)
    clock["t"] += 61  # 窗口滑过
    enforce_user_limit("u1", "ai", 2)


def _dependency_calls(route) -> set:
    """收集一个路由依赖树里所有可调用依赖。"""
    calls, stack = set(), list(route.dependant.dependencies)
    while stack:
        dep = stack.pop()
        calls.add(dep.call)
        stack.extend(dep.dependencies)
    return calls


def test_sensitive_routes_are_rate_limited():
    """锁死接线：这些端点一旦漏挂限流，全局并发槽位就能被单用户占满。

    直接检查各 APIRouter 的 routes（app.routes 在不同 FastAPI 版本里可能是
    未展开的 include 包装对象，不适合做断言）。
    """
    from app.api.v1 import pdf as pdf_module
    from app.api.v1 import qa as qa_module
    from app.api.v1 import sentences as sentences_module
    from app.api.v1 import summary as summary_module
    from app.api.v1 import translate as translate_module
    from app.api.v1 import words as words_module

    expected = [
        ("translate", translate_module.router, "", ai_rate_limit),
        ("translate", translate_module.router, "/stream", ai_rate_limit),
        ("summary", summary_module.router, "/stream", ai_rate_limit),
        ("words", words_module.router, "/analyze", ai_rate_limit),
        ("words", words_module.router, "/stream", ai_rate_limit),
        ("words", words_module.router, "/syllabus-match", syllabus_rate_limit),
        ("sentences", sentences_module.router, "/analyze", ai_rate_limit),
        ("sentences", sentences_module.router, "/stream", ai_rate_limit),
        ("qa", qa_module.router, "/stream", ai_rate_limit),
        ("pdf", pdf_module.router, "/export", export_rate_limit),
    ]

    for module_name, router, path, limiter in expected:
        matches = [r for r in router.routes if getattr(r, "path", None) == path]
        assert matches, f"{module_name} 路由 {path!r} 不存在（路径变了？）"
        assert any(limiter in _dependency_calls(r) for r in matches), (
            f"{module_name} 的 {path!r} 缺少按用户限流依赖"
        )
