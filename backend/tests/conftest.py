"""Pytest 全局环境固定。

必须在导入 ``app.config``（实例化 Settings）之前设置环境变量：
环境变量优先级高于 ``backend/.env``，因此即使本地 .env 配置为
production/DEBUG=false，测试也能拿到确定性行为：

- ENVIRONMENT=development：console 邮件兜底等开发路径可用；
- EXPOSE_DEV_CODES=true：验证码随响应返回 dev_code（认证流程测试依赖）。
"""

import os

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("EXPOSE_DEV_CODES", "true")
