"""Application configuration via environment variables."""

from pydantic import model_validator
from pydantic_settings import BaseSettings


# Publicly-known default secret values — never acceptable outside development.
_INSECURE_SECRETS = (
    "dev-secret-change-in-production",
    "change-me-in-production",
    "",
)


class Settings(BaseSettings):
    # App
    SECRET_KEY: str = "dev-secret-change-in-production"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # JWT / Auth
    JWT_SECRET_KEY: str = ""  # Falls back to SECRET_KEY if empty
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Email verification codes (SMTP) ──
    # SMTP 未配置时：开发环境（ENVIRONMENT=development）走 console 兜底
    # （验证码打印到日志并在 API 响应返回 dev_code），生产环境返回 503。
    SMTP_HOST: str = ""
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""  # 留空回退到 SMTP_USER
    SMTP_SECURITY: str = "ssl"  # ssl | starttls | none
    SMTP_TIMEOUT: int = 15

    EMAIL_CODE_TTL_MINUTES: int = 10
    EMAIL_CODE_LENGTH: int = 6
    EMAIL_CODE_MAX_ATTEMPTS: int = 5
    EMAIL_SEND_COOLDOWN_SECONDS: int = 60
    EMAIL_MAX_PER_HOUR: int = 5  # 同一邮箱每小时最多发送次数
    EMAIL_MAX_PER_IP_PER_HOUR: int = 10  # 同一 IP 每小时最多发送次数（进程内最佳努力）

    # ── Login brute-force throttling (in-memory, per email+IP) ──
    LOGIN_MAX_ATTEMPTS: int = 10
    LOGIN_ATTEMPT_WINDOW_MINUTES: int = 15

    # ── Avatar upload ──
    AVATAR_MAX_MB: int = 2

    # CORS
    CORS_ORIGINS: str = (
        "http://localhost:5173,http://localhost:3000,"
        "http://localhost,http://127.0.0.1"
    )

    # Database (defaults to SQLite for local dev; use PostgreSQL in Docker)
    DATABASE_URL: str = "sqlite+aiosqlite:///./pdfreader.db"
    DATABASE_URL_SYNC: str = "sqlite:///./pdfreader.db"

    # File upload
    MAX_UPLOAD_SIZE_MB: int = 50
    UPLOAD_DIR: str = "./uploads"

    # MinerU Cloud API — 用户必须在前端页面右上角🔑图标自行提供 Token
    MINERU_API_TOKEN: str = ""
    MINERU_API_BASE: str = "https://mineru.net"

    # AI concurrency & batching
    AI_CONCURRENCY: int = 15  # Max concurrent AI API calls
    WORDS_BATCH_SIZE: int = 8  # Max words per AI API call
    SENTENCES_BATCH_SIZE: int = 5  # Deprecated — sentences now processed one per call

    # DeepSeek API — 用户必须在前端页面右上角🔑图标自行提供 API Key
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"

    # Full-document summary
    SUMMARY_MAX_CHARS: int = 30000  # 拼装后的全文最大字符数（超出部分 head+tail 截断）

    # Chrome headless PDF export（留空自动探测 PATH / 常见安装路径）
    CHROME_PATH: str = ""
    PDF_EXPORT_HTML_MAX_MB: int = 5
    PDF_EXPORT_TIMEOUT_SECONDS: int = 45
    PDF_EXPORT_CONCURRENCY: int = 2
    PDF_EXPORT_VIRTUAL_TIME_MS: int = 5000

    # Dictionary (ECDICT local + online fallback)
    DICT_DB_PATH: str = "./data/ecdict.db"
    DICT_API_URL: str = "https://api.dictionaryapi.dev/api/v2/entries/en"


    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore unknown/legacy env vars

    @model_validator(mode="after")
    def _reject_insecure_production_secret(self):
        """Fail fast when running in production with a known default SECRET_KEY.

        A publicly-known signing key lets anyone forge JWTs (including admin
        tokens), so the app must refuse to boot rather than silently run
        insecure. JWT_SECRET_KEY falls back to SECRET_KEY, so both are
        validated. Development environments are exempt.
        """
        jwt_secret = self.JWT_SECRET_KEY or self.SECRET_KEY
        if (
            self.ENVIRONMENT.lower() != "development"
            and (
                self.SECRET_KEY in _INSECURE_SECRETS
                or jwt_secret in _INSECURE_SECRETS
            )
        ):
            raise ValueError(
                "SECRET_KEY must be set to a random value in production "
                "(ENVIRONMENT is not 'development'). Generate one with: "
                "openssl rand -hex 32"
            )
        return self


settings = Settings()
