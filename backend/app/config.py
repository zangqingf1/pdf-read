"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    SECRET_KEY: str = "dev-secret-change-in-production"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database (defaults to SQLite for local dev; use PostgreSQL in Docker)
    DATABASE_URL: str = "sqlite+aiosqlite:///./pdfreader.db"
    DATABASE_URL_SYNC: str = "sqlite:///./pdfreader.db"

    # File upload
    MAX_UPLOAD_SIZE_MB: int = 50
    UPLOAD_DIR: str = "./uploads"

    # MinerU Cloud API
    MINERU_API_TOKEN: str = ""
    MINERU_API_BASE: str = "https://mineru.net"

    # Word analysis
    WORDS_BATCH_SIZE: int = 5  # Max words per DeepSeek API call

    # DeepSeek API (https://platform.deepseek.com/api_keys)
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore unknown/legacy env vars


settings = Settings()
