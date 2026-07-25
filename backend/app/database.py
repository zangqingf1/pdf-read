"""Database engine and session management.

Supports both SQLite (local dev) and PostgreSQL (Docker/production).
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Configure engine based on database URL
_connect_args = {}
_pool_config = {}

if "sqlite" in settings.DATABASE_URL:
    _connect_args = {"check_same_thread": False}
else:
    _pool_config = {
        "pool_size": 20,
        "max_overflow": 10,
        "pool_pre_ping": True,
    }

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args=_connect_args,
    **_pool_config,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency: yields an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Create all tables (dev only; use Alembic for production)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def run_migrations():
    """Apply schema migrations for existing databases.

    SQLAlchemy's create_all only creates new tables — it does NOT add columns
    to existing tables.  This function patches known gaps for users who upgrade
    from an older version without wiping their database.

    Migrations use try/except for idempotency — they are safe to run repeatedly.
    SQLite cannot add FK constraints via ALTER TABLE; FK enforcement is at the
    application layer for SQLite.
    """
    import logging

    logger = logging.getLogger(__name__)

    async with engine.begin() as conn:
        # ── Migration 001: word_analyses.collocations ──
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE word_analyses ADD COLUMN collocations TEXT DEFAULT '[]'"
            )
            logger.info("Migration 001a: added word_analyses.collocations")
        except Exception:
            pass

        # ── Migration 001b: word_analyses.example_sentence ──
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE word_analyses ADD COLUMN example_sentence TEXT DEFAULT ''"
            )
            logger.info("Migration 001b: added word_analyses.example_sentence")
        except Exception:
            pass

        # ═══════════════════════════════════════════════════════════════
        # Migration 002: users table — auth columns
        # ═══════════════════════════════════════════════════════════════
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN hashed_password VARCHAR(255) DEFAULT ''"
            )
            logger.info("Migration 002a: added users.hashed_password")
        except Exception:
            pass

        try:
            await conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"
            )
            logger.info("Migration 002b: added users.is_active")
        except Exception:
            pass

        try:
            await conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT 0"
            )
            logger.info("Migration 002c: added users.is_verified")
        except Exception:
            pass

        try:
            await conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN is_superuser BOOLEAN DEFAULT 0"
            )
            logger.info("Migration 002d: added users.is_superuser")
        except Exception:
            pass

        try:
            await conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN updated_at TIMESTAMP"
            )
            logger.info("Migration 002e: added users.updated_at")
        except Exception:
            pass

        # ═══════════════════════════════════════════════════════════════
        # Migration 003: documents.user_id — user ownership
        # ═══════════════════════════════════════════════════════════════
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE documents ADD COLUMN user_id CHAR(36)"
            )
            logger.info("Migration 003a: added documents.user_id")
        except Exception:
            pass

        try:
            await conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_documents_user_id ON documents(user_id)"
            )
            logger.info("Migration 003b: created index on documents.user_id")
        except Exception:
            pass


async def close_db():
    """Dispose the database engine."""
    await engine.dispose()
