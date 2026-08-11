"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    SECRET_KEY: str = "dev-secret-change-in-production"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # JWT / Auth
    JWT_SECRET_KEY: str = ""  # Falls back to SECRET_KEY if empty
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days

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


    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore unknown/legacy env vars


settings = Settings()
