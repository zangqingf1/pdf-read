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

if "sqlite" in settings.DATABASE_URL:
    from sqlalchemy import event as _sa_event

    @_sa_event.listens_for(engine.sync_engine, "connect")
    def _sqlite_perf_pragmas(dbapi_connection, _connection_record) -> None:
        """Per-connection SQLite tuning.

        - ``journal_mode=WAL``: with the default rollback journal a single write
          transaction blocks every reader for its whole duration; WAL lets reads
          proceed concurrently (important for an async app on SQLite).
        - ``busy_timeout``: turns "database is locked" into a bounded wait when
          two requests write at once instead of failing immediately.
        - ``cache_size``/``temp_store``: keep pages and sort temp tables in
          memory for the large list/aggregate queries.

        Left at SQLite defaults on purpose: ``synchronous`` (durability) and
        ``foreign_keys`` (enforcement semantics — turning it on would change
        existing delete behaviour, so it is not flipped here).
        """
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA cache_size=-32000")
            cursor.execute("PRAGMA temp_store=MEMORY")
        finally:
            cursor.close()

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
            """Run a migration if not already applied, then record it.

            Two failure modes are distinguished:
            - "Column already exists" (manual fix / duplicate) → record the
              migration as applied so we don't retry it forever.
            - Any other failure (syntax error, unexpected DB state) → re-raise
              and abort startup: silently skipping a *real* migration would
              leave the schema missing a column and crash at first use.
            """
            if name in applied:
                return
            try:
                await conn.exec_driver_sql(sql)
                await conn.exec_driver_sql(
                    f"INSERT INTO _migrations (name) VALUES ('{name}')"
                )
                logger.info("Migration %s: applied", name)
            except Exception as exc:
                msg = str(exc).lower()
                already_exists = (
                    "duplicate column" in msg
                    or "already exists" in msg
                    or "duplicate column name" in msg
                )
                if already_exists:
                    # Column/table already present (e.g. from a manual fix) —
                    # record it anyway so we don't retry forever.
                    try:
                        await conn.exec_driver_sql(
                            f"INSERT INTO _migrations (name) VALUES ('{name}')"
                        )
                        logger.warning(
                            "Migration %s: already applied (skipped), recorded",
                            name,
                        )
                    except Exception:
                        pass
                else:
                    logger.error("Migration %s: FAILED — aborting startup", name)
                    raise

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
        # Dialect-neutral form: `INSERT OR IGNORE` is SQLite-only and would
        # abort startup on PostgreSQL, so guard with NOT EXISTS instead.
        await _apply(
            "004b_prompt_templates_copy_data",
            "INSERT INTO _prompt_templates_v2 "
            "  (name, is_default, system_prompt, user_prompt, created_at, updated_at)"
            "  SELECT name, 0, system_prompt, user_prompt, created_at, updated_at"
            "  FROM prompt_templates"
            "  WHERE NOT EXISTS ("
            "    SELECT 1 FROM _prompt_templates_v2 AS t"
            "    WHERE t.name = prompt_templates.name AND t.is_default = 0"
            "  )",
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

        # ═══════════════════════════════════════════════════════════════
        # Migration 005: documents — full-document summary
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "005a_documents_summary",
            "ALTER TABLE documents ADD COLUMN summary TEXT",
        )
        await _apply(
            "005b_documents_summary_updated_at",
            "ALTER TABLE documents ADD COLUMN summary_updated_at TIMESTAMP",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 006: documents — 大标题中文翻译
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "006a_documents_title_zh",
            "ALTER TABLE documents ADD COLUMN title_zh TEXT",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 007: documents — 多类型源（非 PDF 文件 + URL 链接）
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "007a_documents_source_type",
            "ALTER TABLE documents ADD COLUMN source_type VARCHAR(20)",
        )
        await _apply(
            "007b_documents_file_ext",
            "ALTER TABLE documents ADD COLUMN file_ext VARCHAR(20)",
        )
        await _apply(
            "007c_documents_source_url",
            "ALTER TABLE documents ADD COLUMN source_url VARCHAR(2000)",
        )
        # 回填历史数据：旧文档全部是 PDF 上传
        await _apply(
            "007d_backfill_source_type",
            "UPDATE documents SET source_type='upload' WHERE source_type IS NULL",
        )
        await _apply(
            "007e_backfill_file_ext",
            "UPDATE documents SET file_ext='.pdf' WHERE file_ext IS NULL",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 008: users — 头像（注册/资料页自定义头像）
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "008a_users_avatar_url",
            "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500)",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 009: users — JWT token version (revoke on password reset)
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "009a_users_token_version",
            "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 010: paragraphs — MinerU 布局坐标（PDF 预览解析框）
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "010a_paragraphs_bbox_json",
            "ALTER TABLE paragraphs ADD COLUMN bbox_json TEXT",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 011: vocabulary_entries — 单词本（用户级，词典释义）
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "011a_vocabulary_entries",
            "CREATE TABLE IF NOT EXISTS vocabulary_entries ("
            "  id VARCHAR(36) NOT NULL PRIMARY KEY,"
            "  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  word VARCHAR(200) NOT NULL,"
            "  word_original VARCHAR(200) NOT NULL,"
            "  phonetic VARCHAR(200) DEFAULT '',"
            "  pos VARCHAR(50) DEFAULT '',"
            "  translation TEXT DEFAULT '',"
            "  definition_en TEXT DEFAULT '',"
            "  source_document_id VARCHAR(36) REFERENCES documents(id) ON DELETE SET NULL,"
            "  context_sentence TEXT,"
            "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "  UNIQUE (user_id, word)"
            ")",
        )
        await _apply(
            "011b_vocab_idx_user_created",
            "CREATE INDEX IF NOT EXISTS idx_vocab_user_created ON vocabulary_entries(user_id, created_at)",
        )
        await _apply(
            "011c_vocab_idx_user_pos",
            "CREATE INDEX IF NOT EXISTS idx_vocab_user_pos ON vocabulary_entries(user_id, pos)",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 012: vocabulary — multi-source + document order
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "012a_vocabulary_sources",
            "CREATE TABLE IF NOT EXISTS vocabulary_sources ("
            "  id VARCHAR(36) NOT NULL PRIMARY KEY,"
            "  vocabulary_entry_id VARCHAR(36) NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,"
            "  document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,"
            "  document_title TEXT,"
            "  paragraph_index INTEGER,"
            "  token_rank INTEGER,"
            "  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "  UNIQUE (vocabulary_entry_id, document_id)"
            ")",
        )
        await _apply(
            "012b_vocab_sources_idx_entry",
            "CREATE INDEX IF NOT EXISTS idx_vocab_source_entry ON vocabulary_sources(vocabulary_entry_id)",
        )
        await _apply(
            "012c_vocab_sources_idx_doc",
            "CREATE INDEX IF NOT EXISTS idx_vocab_source_doc ON vocabulary_sources(document_id)",
        )
        await _apply(
            "012d_vocab_latest_paragraph_index",
            "ALTER TABLE vocabulary_entries ADD COLUMN latest_paragraph_index INTEGER",
        )
        await _apply(
            "012e_vocab_latest_token_rank",
            "ALTER TABLE vocabulary_entries ADD COLUMN latest_token_rank INTEGER",
        )
        await _apply(
            "012f_vocab_idx_doc_order",
            "CREATE INDEX IF NOT EXISTS idx_vocab_user_doc_order ON vocabulary_entries(user_id, latest_paragraph_index, latest_token_rank)",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 013: vocabulary_entries — 补全富字段（与阅读页 WordAnalysis 对齐）
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "013a_vocab_definition_zh",
            "ALTER TABLE vocabulary_entries ADD COLUMN definition_zh TEXT DEFAULT ''",
        )
        await _apply(
            "013b_vocab_base_form",
            "ALTER TABLE vocabulary_entries ADD COLUMN base_form TEXT DEFAULT ''",
        )
        await _apply(
            "013c_vocab_plural_form",
            "ALTER TABLE vocabulary_entries ADD COLUMN plural_form TEXT DEFAULT ''",
        )
        await _apply(
            "013d_vocab_synonyms_antonyms",
            "ALTER TABLE vocabulary_entries ADD COLUMN synonyms_antonyms TEXT DEFAULT '{\"synonyms\": []}'",
        )
        await _apply(
            "013e_vocab_cognates",
            "ALTER TABLE vocabulary_entries ADD COLUMN cognates TEXT DEFAULT '[]'",
        )
        await _apply(
            "013f_vocab_collocations",
            "ALTER TABLE vocabulary_entries ADD COLUMN collocations TEXT DEFAULT '[]'",
        )

        # Best-effort one-time backfill: copy rich fields from word_analyses
        # (matched by lowercased word + source document). Never blocks startup.
        try:
            if "013g_vocab_rich_backfill" not in applied:
                await conn.exec_driver_sql(
                    "UPDATE vocabulary_entries SET "
                    "definition_zh = COALESCE((SELECT wa.definition_zh FROM word_analyses wa "
                    "  WHERE LOWER(wa.word)=vocabulary_entries.word AND wa.document_id=vocabulary_entries.source_document_id "
                    "  AND wa.definition_zh IS NOT NULL AND wa.definition_zh <> '' LIMIT 1), definition_zh), "
                    "base_form = COALESCE((SELECT wa.base_form FROM word_analyses wa "
                    "  WHERE LOWER(wa.word)=vocabulary_entries.word AND wa.document_id=vocabulary_entries.source_document_id "
                    "  AND wa.base_form IS NOT NULL AND wa.base_form <> '' LIMIT 1), base_form), "
                    "plural_form = COALESCE((SELECT wa.plural_form FROM word_analyses wa "
                    "  WHERE LOWER(wa.word)=vocabulary_entries.word AND wa.document_id=vocabulary_entries.source_document_id "
                    "  AND wa.plural_form IS NOT NULL AND wa.plural_form <> '' LIMIT 1), plural_form), "
                    "synonyms_antonyms = COALESCE((SELECT wa.synonyms_antonyms FROM word_analyses wa "
                    "  WHERE LOWER(wa.word)=vocabulary_entries.word AND wa.document_id=vocabulary_entries.source_document_id "
                    "  AND wa.synonyms_antonyms IS NOT NULL AND wa.synonyms_antonyms <> '' AND wa.synonyms_antonyms <> '{\"synonyms\": []}' LIMIT 1), synonyms_antonyms), "
                    "cognates = COALESCE((SELECT wa.cognates FROM word_analyses wa "
                    "  WHERE LOWER(wa.word)=vocabulary_entries.word AND wa.document_id=vocabulary_entries.source_document_id "
                    "  AND wa.cognates IS NOT NULL AND wa.cognates <> '' AND wa.cognates <> '[]' LIMIT 1), cognates), "
                    "collocations = COALESCE((SELECT wa.collocations FROM word_analyses wa "
                    "  WHERE LOWER(wa.word)=vocabulary_entries.word AND wa.document_id=vocabulary_entries.source_document_id "
                    "  AND wa.collocations IS NOT NULL AND wa.collocations <> '' AND wa.collocations <> '[]' LIMIT 1), collocations) "
                    "WHERE source_document_id IS NOT NULL"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013g_vocab_rich_backfill')"
                )
                logger.info("Migration 013g: rich-field backfill applied")
        except Exception as exc:
            logger.warning("Migration 013g: backfill skipped (%s)", exc)
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013g_vocab_rich_backfill')"
                )
            except Exception:
                pass

        # ═══════════════════════════════════════════════════════════════
        # Migration 014: 考纲标签（ECDICT 离线判定，JSON 数组字符串）
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "014a_word_analyses_exam_tags",
            "ALTER TABLE word_analyses ADD COLUMN exam_tags TEXT DEFAULT '[]'",
        )
        await _apply(
            "014b_vocabulary_exam_tags",
            "ALTER TABLE vocabulary_entries ADD COLUMN exam_tags TEXT DEFAULT '[]'",
        )

        # Best-effort one-time backfill: recompute every vocabulary entry's
        # exam tags straight from ECDICT. Covers entries added before the tag
        # logic existed (empty) and refreshes values carrying old derived
        # labels (COCA). Local-only, idempotent, never blocks startup.
        try:
            if "014c_vocab_exam_tags_backfill" not in applied:
                await _backfill_vocabulary_exam_tags()
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('014c_vocab_exam_tags_backfill')"
                )
                logger.info("Migration 014c: vocabulary exam tags backfill applied")
        except Exception as exc:
            logger.warning("Migration 014c: exam tags backfill skipped (%s)", exc)
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('014c_vocab_exam_tags_backfill')"
                )
            except Exception:
                pass

        # Best-effort one-time backfill: populate latest_paragraph_index from
        # word_analyses (reliable even when the documents.paragraphs table is
        # empty/purged). Never blocks startup.
        try:
            if "013h_vocab_para_backfill" not in applied:
                await conn.exec_driver_sql(
                    "UPDATE vocabulary_entries SET latest_paragraph_index = ("
                    "  SELECT MIN(wa.paragraph_index) FROM word_analyses wa"
                    "  WHERE wa.document_id = vocabulary_entries.source_document_id"
                    "    AND LOWER(wa.word) = vocabulary_entries.word"
                    ") WHERE source_document_id IS NOT NULL"
                    "  AND latest_paragraph_index IS NULL"
                    "  AND ("
                    "    SELECT MIN(wa.paragraph_index) FROM word_analyses wa"
                    "    WHERE wa.document_id = vocabulary_entries.source_document_id"
                    "      AND LOWER(wa.word) = vocabulary_entries.word"
                    "  ) IS NOT NULL"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013h_vocab_para_backfill')"
                )
                logger.info("Migration 013h: paragraph-index backfill applied")
        except Exception as exc:
            logger.warning("Migration 013h: backfill skipped (%s)", exc)
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013h_vocab_para_backfill')"
                )
            except Exception:
                pass

        # Best-effort one-time backfill: reconstruct vocabulary_sources from
        # word_analyses so the word book can show *every* document a word was
        # parsed in (not just the latest). Idempotent — existing rows are
        # skipped. SQLite-oriented (dev DB); wrapped so PG installs skip safely.
        try:
            if "013i_vocab_sources_backfill" not in applied:
                await conn.exec_driver_sql(
                    "INSERT INTO vocabulary_sources "
                    "(id, vocabulary_entry_id, document_id, document_title, paragraph_index, added_at) "
                    "SELECT hex(randomblob(16)), ve.id, wa.document_id, d.title, MIN(wa.paragraph_index), CURRENT_TIMESTAMP "
                    "FROM word_analyses wa "
                    "JOIN documents d ON REPLACE(d.id,'-','') = REPLACE(wa.document_id,'-','') "
                    "JOIN vocabulary_entries ve ON REPLACE(ve.user_id,'-','') = REPLACE(d.user_id,'-','') AND ve.word = LOWER(wa.word) "
                    "WHERE NOT EXISTS ("
                    "  SELECT 1 FROM vocabulary_sources vs "
                    "  WHERE vs.vocabulary_entry_id = ve.id AND vs.document_id = wa.document_id"
                    ") "
                    "GROUP BY ve.id, wa.document_id, d.title"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013i_vocab_sources_backfill')"
                )
                logger.info("Migration 013i: vocabulary_sources backfill applied")
        except Exception as exc:
            logger.warning("Migration 013i: backfill skipped (%s)", exc)
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013i_vocab_sources_backfill')"
                )
            except Exception:
                pass

        # Guarantee each entry has at least its latest source document recorded
        # (covers words added without a matching word_analyses row).
        try:
            if "013j_vocab_sources_latest_backfill" not in applied:
                await conn.exec_driver_sql(
                    "INSERT INTO vocabulary_sources "
                    "(id, vocabulary_entry_id, document_id, document_title, added_at) "
                    "SELECT hex(randomblob(16)), ve.id, ve.source_document_id, COALESCE(d.title, ''), CURRENT_TIMESTAMP "
                    "FROM vocabulary_entries ve "
                    "LEFT JOIN documents d ON REPLACE(d.id,'-','') = REPLACE(ve.source_document_id,'-','') "
                    "WHERE ve.source_document_id IS NOT NULL "
                    "  AND NOT EXISTS ("
                    "    SELECT 1 FROM vocabulary_sources vs "
                    "    WHERE vs.vocabulary_entry_id = ve.id AND vs.document_id = ve.source_document_id"
                    "  )"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013j_vocab_sources_latest_backfill')"
                )
                logger.info("Migration 013j: vocabulary_sources latest backfill applied")
        except Exception as exc:
            logger.warning("Migration 013j: backfill skipped (%s)", exc)
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013j_vocab_sources_latest_backfill')"
                )
            except Exception:
                pass

        # Best-effort one-time backfill: fill empty phonetics for existing
        # entries from the base/lemma form (ECDICT stores inflected forms with
        # an empty phonetic — see dictionary_service.lookup). Local-only,
        # idempotent, never blocks startup.
        try:
            if "013k_vocab_phonetic_backfill" not in applied:
                await _backfill_vocabulary_phonetics()
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013k_vocab_phonetic_backfill')"
                )
                logger.info("Migration 013k: phonetic backfill applied")
        except Exception as exc:
            logger.warning("Migration 013k: phonetic backfill skipped (%s)", exc)
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES ('013k_vocab_phonetic_backfill')"
                )
            except Exception:
                pass

        # ═══════════════════════════════════════════════════════════════
        # Migration 015: 文档收藏标记（首页「我的收藏」/ 阅读页星标）
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "015a_documents_is_favorite",
            "ALTER TABLE documents ADD COLUMN is_favorite BOOLEAN DEFAULT 0",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 016: SRS 间隔重复复习（vocabulary_entries 调度字段）
        # 每个单词本条目即一张复习卡；srs_due_at NULL = 新卡即到期。
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "016a_vocab_srs_due_at",
            "ALTER TABLE vocabulary_entries ADD COLUMN srs_due_at TIMESTAMP NULL",
        )
        await _apply(
            "016b_vocab_srs_interval_days",
            "ALTER TABLE vocabulary_entries ADD COLUMN srs_interval_days FLOAT DEFAULT 0",
        )
        await _apply(
            "016c_vocab_srs_ease",
            "ALTER TABLE vocabulary_entries ADD COLUMN srs_ease FLOAT DEFAULT 2.5",
        )
        await _apply(
            "016d_vocab_srs_reps",
            "ALTER TABLE vocabulary_entries ADD COLUMN srs_reps INTEGER DEFAULT 0",
        )
        await _apply(
            "016e_vocab_srs_lapses",
            "ALTER TABLE vocabulary_entries ADD COLUMN srs_lapses INTEGER DEFAULT 0",
        )
        await _apply(
            "016f_vocab_srs_status",
            "ALTER TABLE vocabulary_entries ADD COLUMN srs_status VARCHAR(16) DEFAULT 'active'",
        )
        await _apply(
            "016g_vocab_srs_last_reviewed_at",
            "ALTER TABLE vocabulary_entries ADD COLUMN srs_last_reviewed_at TIMESTAMP NULL",
        )
        await _apply(
            "016h_vocab_srs_index",
            "CREATE INDEX IF NOT EXISTS idx_vocab_user_srs ON vocabulary_entries(user_id, srs_status, srs_due_at)",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 017: QA 引用句精确定位（引用句所在句子索引 + 原文）
        # user 消息若带引用句，把 sentence_index/sentence_text 一并落库，
        # 历史会话刷新后引用卡仍能显示句原文并精确跳句。
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "017a_qa_messages_sentence_index",
            "ALTER TABLE qa_messages ADD COLUMN sentence_index INTEGER NULL",
        )
        await _apply(
            "017b_qa_messages_sentence_text",
            "ALTER TABLE qa_messages ADD COLUMN sentence_text TEXT NULL",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 018: documents 列表/启动恢复用的索引
        # - (user_id, created_at)：文档列表按创建时间倒序分页
        # - created_at：管理后台全量按创建时间倒序
        # - parse_status：启动时把孤儿 processing/awaiting_selection 改 failed，
        #   原先无索引 → 每次启动两次全表扫描
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "018a_documents_idx_user_created",
            "CREATE INDEX IF NOT EXISTS idx_documents_user_created "
            "ON documents(user_id, created_at)",
        )
        await _apply(
            "018b_documents_idx_created_at",
            "CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at)",
        )
        await _apply(
            "018c_documents_idx_parse_status",
            "CREATE INDEX IF NOT EXISTS idx_documents_parse_status ON documents(parse_status)",
        )

        # ═══════════════════════════════════════════════════════════════
        # Migration 019: feedbacks 支持多张截图（最多 FEEDBACK_MAX_IMAGES 张）
        # 单列 image_path 换成 JSON 数组文本 image_paths；老库先加列，
        # 再把已存在的单张路径回填成 ["<path>"]（019b，best-effort）。
        # ═══════════════════════════════════════════════════════════════
        await _apply(
            "019a_feedbacks_image_paths",
            "ALTER TABLE feedbacks ADD COLUMN image_paths TEXT NULL",
        )
        # 老库单图数据回填为单元素数组。新库没有 image_path 列，UPDATE 会报错，
        # 由 except 兜住并记录 —— 回填类迁移永不阻塞启动。
        try:
            if "019b_feedbacks_image_paths_backfill" not in applied:
                await conn.exec_driver_sql(
                    "UPDATE feedbacks SET image_paths = '[\"' || image_path || '\"]'"
                    " WHERE image_path IS NOT NULL AND image_paths IS NULL"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES "
                    "('019b_feedbacks_image_paths_backfill')"
                )
                logger.info("Migration 019b: feedback image paths backfill applied")
        except Exception as exc:
            logger.warning("Migration 019b: backfill skipped (%s)", exc)
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO _migrations (name) VALUES "
                    "('019b_feedbacks_image_paths_backfill')"
                )
            except Exception:
                pass


async def _backfill_vocabulary_phonetics():
    """Fill empty phonetics using the base-form fallback (see dictionary_service)."""
    from app.services import dictionary_service as ds
    from sqlalchemy import text

    async with async_session_factory() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT id, word FROM vocabulary_entries "
                    "WHERE phonetic IS NULL OR phonetic = ''"
                )
            )
        ).fetchall()
        for eid, word in rows:
            ph = None
            exact = await ds._lookup_local(word)
            if exact and exact.get("phonetic"):
                ph = exact["phonetic"]
            else:
                for lemma in ds._lemmatize(word):
                    base = await ds._lookup_local(lemma)
                    if base and base.get("phonetic"):
                        ph = base["phonetic"]
                        break
            if ph:
                await db.execute(
                    text("UPDATE vocabulary_entries SET phonetic = :p WHERE id = :e"),
                    {"p": ph, "e": eid},
                )
        await db.commit()


async def _backfill_vocabulary_exam_tags():
    """Recompute every entry's exam tags straight from ECDICT (see dictionary_service).

    Overwrites each row whose word yields tags — refreshing empty values and
    ones carrying old derived labels (COCA) to the native 8-tag scheme in one
    pass. Rows without an ECDICT hit are left untouched so a missing
    ecdict.db can never wipe existing data; batch-add computes tags directly
    for newly added words.
    """
    import json as _json

    from app.services import dictionary_service as ds
    from sqlalchemy import text

    async with async_session_factory() as db:
        rows = (
            await db.execute(text("SELECT id, word FROM vocabulary_entries"))
        ).fetchall()
        if not rows:
            return
        words = [w for _, w in rows]
        tags_map = await ds.lookup_exam_tags(words)
        for eid, word in rows:
            tags = tags_map.get((word or "").lower())
            if not tags:
                continue
            await db.execute(
                text(
                    "UPDATE vocabulary_entries SET exam_tags = :t WHERE id = :e"
                ),
                {"t": _json.dumps(tags, ensure_ascii=False), "e": eid},
            )
        await db.commit()


async def close_db():
    """Dispose the database engine."""
    await engine.dispose()
