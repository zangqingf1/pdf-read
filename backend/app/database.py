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

    A simple ``_migrations`` table tracks which migrations have been applied,
    so we skip redundant ALTER TABLE on every startup.  Migrations that fail
    (column already exists, etc.) are still caught by the try/except guard.
    """
    import logging

    logger = logging.getLogger(__name__)

    async with engine.begin() as conn:
        # Ensure the migration tracking table exists
        await conn.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS _migrations (name VARCHAR(100) PRIMARY KEY)"
        )

        # Fetch already-applied migrations
        result = await conn.exec_driver_sql("SELECT name FROM _migrations")
        applied: set[str] = {row[0] for row in result.fetchall()}

        async def _apply(name: str, sql: str):
            """Run a migration if not already applied, then record it."""
            if name in applied:
                return
            try:
                await conn.exec_driver_sql(sql)
                await conn.exec_driver_sql(
                    f"INSERT INTO _migrations (name) VALUES ('{name}')"
                )
                logger.info("Migration %s: applied", name)
            except Exception:
                # Migration failed (e.g. column already exists from a
                # manual fix) — record it anyway so we don't retry forever.
                try:
                    await conn.exec_driver_sql(
                        f"INSERT INTO _migrations (name) VALUES ('{name}')"
                    )
                except Exception:
                    pass

        # ── Migration 001a: word_analyses.collocations ──
        await _apply(
            "001a_word_analyses_collocations",
            "ALTER TABLE word_analyses ADD COLUMN collocations TEXT DEFAULT '[]'",
        )

        # ── Migration 001b: word_analyses.example_sentence ──
        await _apply(
            "001b_word_analyses_example_sentence",
            "ALTER TABLE word_analyses ADD COLUMN example_sentence TEXT DEFAULT ''",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 002: users table — auth columns
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "002a_users_hashed_password",
            "ALTER TABLE users ADD COLUMN hashed_password VARCHAR(255) DEFAULT ''",
        )
        await _apply(
            "002b_users_is_active",
            "ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1",
        )
        await _apply(
            "002c_users_is_verified",
            "ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT 0",
        )
        await _apply(
            "002d_users_is_superuser",
            "ALTER TABLE users ADD COLUMN is_superuser BOOLEAN DEFAULT 0",
        )
        await _apply(
            "002e_users_updated_at",
            "ALTER TABLE users ADD COLUMN updated_at TIMESTAMP",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 004: prompt_templates.is_default — two-tier prompts
        # ═══════════════════════════════════════════════════════════════
        # SQLite cannot ALTER PRIMARY KEY, so we recreate the table.
        # Step 1: create new table with composite PK (name, is_default).
        await _apply(
            "004a_prompt_templates_new_schema",
            "CREATE TABLE IF NOT EXISTS _prompt_templates_v2 ("
            "  name VARCHAR(50) NOT NULL,"
            "  is_default BOOLEAN NOT NULL DEFAULT 0,"
            "  system_prompt TEXT DEFAULT '',"
            "  user_prompt TEXT DEFAULT '',"
            "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "  PRIMARY KEY (name, is_default)"
            ")",
        )
        # Step 2: copy existing rows (all legacy rows become is_default=False).
        await _apply(
            "004b_prompt_templates_copy_data",
            "INSERT OR IGNORE INTO _prompt_templates_v2 "
            "  (name, is_default, system_prompt, user_prompt, created_at, updated_at)"
            "  SELECT name, 0, system_prompt, user_prompt, created_at, updated_at"
            "  FROM prompt_templates",
        )
        # Step 3: swap tables.
        await _apply(
            "004c_prompt_templates_drop_old",
            "DROP TABLE IF EXISTS prompt_templates",
        )
        await _apply(
            "004d_prompt_templates_rename_v2",
            "ALTER TABLE _prompt_templates_v2 RENAME TO prompt_templates",
        )


async def close_db():
    """Dispose the database engine."""
    await engine.dispose()
