"""Pytest 全局环境固定。

必须在导入 ``app.config``（实例化 Settings）之前设置环境变量：
环境变量优先级高于 ``backend/.env``，因此即使本地 .env 配置为
production/DEBUG=false，测试也能拿到确定性行为：

- ENVIRONMENT=development：console 邮件兜底等开发路径可用；
- EXPOSE_DEV_CODES=true：验证码随响应返回 dev_code（认证流程测试依赖）。
"""

import os

import pytest

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("EXPOSE_DEV_CODES", "true")


@pytest.fixture(autouse=True)
def _reset_user_rate_limits():
    """按用户限流是进程内状态，必须逐用例清空，否则计数会跨用例累积误触 429。"""
    from app.utils.rate_limit import reset_rate_limits

    reset_rate_limits()
    yield
    reset_rate_limits()
