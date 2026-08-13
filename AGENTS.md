# AGENTS.md

## 项目概述

PDF 外刊阅读工具 — 上传/粘贴 URL 获取英文材料（PDF/DOCX/PPT/图片/HTML 均支持），自动提取正文，AI 段落翻译 + 单词解析 + 长难句拆解 + 全文总结，支持段落编辑校对、单词发音、导出 PDF，纯净阅读体验。含 JWT 认证系统和超级管理员后台。

> `CLAUDE.md` 是本文件的旧副本（内容相同）。改动 `AGENTS.md` 后保持同步。

## 开发命令

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000   # SQLite 开发模式（启动自动建表+增量迁移）
ruff check .
python -m pytest tests -q                   # 单元测试（离线，mock AI/OCR）

# 前端
cd frontend
npm install --legacy-peer-deps
npm run dev              # Vite :5173, /api → 127.0.0.1:8000
npm run build            # tsc -b + vite build
npm run lint             # eslint --max-warnings 0

# Docker 全栈（PostgreSQL + Redis + Celery + Nginx）
cp .env.example .env     # 填 SECRET_KEY；MinerU/DeepSeek Key 走前端🔑，可留空
docker-compose up -d     # 前端 :80, API :8000
```

## 架构

### 后端 (FastAPI + SQLAlchemy async)

```
app/
├── api/v1/
│   ├── pdf.py        # 上传/URL解析/状态/结果/源文件/标题编辑/段落编辑/页面选择/文档管理/PDF导出
│   ├── translate.py  # 段落翻译（POST 批量 + POST /stream SSE）
│   ├── words.py      # 单词解析（analyze + stream SSE + list/delete）
│   ├── sentences.py  # 长难句拆解（analyze + stream SSE + list/delete）
│   ├── prompts.py    # Prompt 模板管理（两层体系，可编辑/重置/提升为默认）
│   ├── summary.py    # 全文总结（SSE）+ 草稿保存
│   ├── tts.py        # 单词发音 + 段落朗读（edge-tts, 需鉴权）
│   └── admin.py      # 管理后台 API（superuser only）
├── auth/
│   ├── router.py     # POST /register, /login, GET /me
│   ├── deps.py       # get_current_user / superuser 依赖（新代码从这里 import）
│   ├── security.py   # JWT create/verify + bcrypt（bcrypt 直连，无 passlib）
│   └── schemas.py
├── services/
│   ├── pdf_service.py     # 解析编排 + 文件保存 + URL 源下载
│   ├── ocr_engine.py      # MinerU Cloud（batch file-upload / URL 两条路径）
│   ├── ai_service.py      # DeepSeek: 翻译/单词/句子/总结（并发 + 指数退避重试）
│   ├── prompt_defaults.py # 出厂默认 Prompt + PLACEHOLDERS + TEMPLATE_NAMES
│   ├── page_utils.py      # PDF 页数统计 + 页面提取
│   ├── export_service.py  # Chrome 无头渲染 HTML→PDF（零新依赖）
│   ├── tts_service.py     # edge-tts 合成 + 磁盘缓存 + 段落 WordBoundary 词级时间戳
│   ├── file_types.py      # 支持的文件类型/扩展名/MinerU 模型选择（vlm / MinerU-HTML）
│   └── url_downloader.py  # URL 内容下载
├── models/   # 每类一文件: user/document/paragraph/word_analysis/sentence_analysis/prompt_template
├── schemas/  # 与 api/v1 路由一一对应 + admin
├── tasks/    # celery_app（Redis 不可用→None）+ pdf_tasks（Celery 缺失时降级）
├── config.py     # pydantic-settings (.env)
├── database.py   # engine + get_db + init_db + run_migrations
└── main.py       # lifespan: 建表 → 增量迁移 → 孤儿 processing/awaiting_selection→failed
```

**关键决策：**
- DB 默认 SQLite（`backend/pdfreader.db`），Docker 切 PostgreSQL
- 启动自动 `init_db()` 建表 + `run_migrations()` 增量加列（`_migrations` 表去重）。**给既有表加列必须写进 `run_migrations()`**，`create_all` 不会补列
- AI 只接 **DeepSeek**（`DEEPSEEK_MODEL`，默认 `deepseek-v4-flash`），指数退避重试，`Semaphore(settings.AI_CONCURRENCY=15)` 并发；`provider` 参数是预留扩展点（仅 `"deepseek"` 合法）
- **MinerU Token / DeepSeek Key 不在 .env 里配** — 每个用户在前端🔑处自填，随请求传 `mineru_token` / `api_key` 字段
- 解析任务：开发/常规部署走 FastAPI `BackgroundTasks`（`_parse_in_background`）；Celery 仅在 Redis 可用时启用
- `get_db` 依赖注入自动 commit/rollback
- Prompt 两层体系：DB 行有复合主键 `(name, is_default)`；生效优先级 = 自定义 `is_default=False` > 系统默认 `True` > 出厂默认 `prompt_defaults.py`。`_resolve_prompt()` 用 `_SafeDict` + `str.format_map()` 替换占位符

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | 注册 |
| POST | `/api/v1/auth/login` | 登录，返回 JWT |
| GET | `/api/v1/auth/me` | 当前用户信息 |
| POST | `/api/v1/pdf/upload` | 上传文件（响应直接含 `page_count`） |
| POST | `/api/v1/pdf/parse-url` | 解析 URL（文件链接或网页） |
| GET | `/api/v1/pdf/status/{task_id}` | 查询解析状态 |
| GET | `/api/v1/pdf/result/{task_id}` | 解析结果（段落+单词/句子解析+总结） |
| GET | `/api/v1/pdf/file/{task_id}` | 源文件（预览用） |
| POST | `/api/v1/pdf/select-pages` | 选页后触发解析（仅 PDF，≤10 页） |
| GET | `/api/v1/pdf/documents` | 文档列表（分页） |
| POST | `/api/v1/pdf/documents/batch-delete` | 批量删除（user-scoped） |
| DELETE | `/api/v1/pdf/documents/{task_id}` | 删除文档 |
| POST | `/api/v1/pdf/retry/{task_id}` | 重试失败文档 |
| PUT | `/api/v1/pdf/documents/{task_id}/title` | 编辑大标题（变更清空 title_zh） |
| PUT | `/api/v1/pdf/documents/{task_id}/paragraphs` | 批量更新段落（英文变更清空译文） |
| DELETE | `/api/v1/pdf/documents/{task_id}/paragraphs/{idx}` | 删除段落（自动重排索引） |
| POST | `/api/v1/pdf/documents/{task_id}/paragraphs/merge` | 合并相邻段落 |
| PUT | `/api/v1/pdf/documents/{task_id}/paragraphs/reorder` | 拖拽重排（不失效译文） |
| POST | `/api/v1/pdf/export` | 服务端 Chrome 渲染导出 PDF |
| POST | `/api/v1/translate` | 段落翻译（批量） |
| POST | `/api/v1/translate/stream` | 段落翻译（SSE 渐进） |
| POST | `/api/v1/words/analyze` | 单词解析 (upsert) |
| POST | `/api/v1/words/stream` | 单词解析（SSE，含 `incomplete` 事件） |
| GET | `/api/v1/words/list/{document_id}` | 单词解析列表 |
| DELETE | `/api/v1/words/{analysis_id}` | 删除单词解析 |
| POST | `/api/v1/sentences/analyze` | 句子解析 (upsert) |
| POST | `/api/v1/sentences/stream` | 句子解析（SSE） |
| GET | `/api/v1/sentences/list/{document_id}` | 句子解析列表 |
| DELETE | `/api/v1/sentences/{analysis_id}` | 删除句子解析 |
| POST | `/api/v1/summary/stream` | 全文总结/修改（SSE，后端自取正文） |
| PUT | `/api/v1/summary/draft` | 保存总结草稿（空白=清空） |
| GET | `/api/v1/tts` | 单词发音 mp3（edge-tts，`?word=&accent=us|uk`） |
| GET | `/api/v1/tts/paragraph/{document_id}` | 段落朗读 mp3 + 词级时间戳（`?index=&accent=&rate=`，卡拉OK高亮/句子起播用） |
| GET | `/api/v1/prompts` | 列出所有 Prompt（含生效层级） |
| GET | `/api/v1/prompts/{name}` | 查看单个 Prompt |
| PUT | `/api/v1/prompts/{name}` | 保存自定义（`set_as_default=true` 存为系统默认） |
| PUT | `/api/v1/prompts/{name}/default` | 设置系统默认 |
| POST | `/api/v1/prompts/{name}/promote` | 自定义提升为系统默认 |
| GET | `/api/v1/prompts/{name}/default` | 查看出厂默认（只读） |
| POST | `/api/v1/prompts/{name}/reset` | 重置单个（删全部 DB 行） |
| POST | `/api/v1/prompts/reset-all` | 重置全部 |
| GET | `/api/v1/admin/stats` | 管理统计 |
| GET | `/api/v1/admin/users` | 用户列表 |
| PUT | `/api/v1/admin/users/{user_id}` | 编辑用户 |
| DELETE | `/api/v1/admin/users/{user_id}` | 删除用户 |
| GET | `/api/v1/admin/documents` | 全部文档列表 |
| POST | `/api/v1/admin/documents/batch-delete` | 批量删除文档 |
| DELETE | `/api/v1/admin/documents/{doc_id}` | 删除单个文档 |
| GET | `/health` | 健康检查 |

**Prompt 模板**: 四种 (`translate`, `analyze_words`, `analyze_sentences`, `summary`) 全部可编辑。`_VALID_NAMES` 从 `DEFAULT_PROMPTS.keys()` 动态派生。

### 数据模型

- **User**: `email`(unique), `nickname`, `password_hash`, `is_superuser`, `is_active`, `created_at`
- **Document**: UUID 主键, `parse_status` (pending→awaiting_selection(仅PDF)→processing→completed/failed), cascade delete。另有 `title_zh`（大标题中文翻译）、`source_type`(`upload`/`url`)、`file_ext`、`source_url`、`summary`+`summary_updated_at`（草稿与 AI 结果共用一列）。`original_text`/`word_count`/`paragraph_count` 为聚合字段，编辑后在后端重算
- **Paragraph**: `(document_id, index)` 唯一索引, `text_en`, `text_zh`, `page_number`（英文变更→译文清空待重译）
- **WordAnalysis**: `(document_id, paragraph_index, word)` 唯一, upsert。含 phonetic, definition, cognates, synonyms_antonyms 等
- **SentenceAnalysis**: `(document_id, paragraph_index, sentence_index)` 唯一, upsert。含 `structure_json`（新格式 `{"content": ...}`，旧格式向前兼容重建）
- **PromptTemplate**: **复合主键 `(name, is_default)`**, `system_prompt` + `user_prompt`。无 DB 行=出厂默认

### 解析流程

1. 上传文件（`file_types.SUPPORTED_UPLOAD_EXTENSIONS` 白名单，≤50MB）或 URL → `pdf_service` 落盘/下载
2. 仅 PDF 有「页」概念：upload 响应直接返回 `page_count` → 前端 `PageSelector` (react-pdf 缩略图) 选页（≤10）→ `select-pages`；非 PDF / URL 源跳过选页直接解析
3. MinerU：文件走 batch file-upload API；HTML 扩展名用 `MinerU-HTML` 模型；URL 走 `parse_url`（网页用 MinerU-HTML 服务端抓取）
4. 下载 zip → `content_list.json` 优先, `full.md` 回退
5. `_map_page_numbers()` 将 MinerU 0-based 索引映射回原文档页码

### 前端 (React 18 + TypeScript + Zustand + Tailwind CSS)

```
pages/          # Home/Reader/Review/Login/Register + admin/ (Dashboard/Users/Documents/Prompts)
components/
├── home/       # PDFUploader, PageSelector, RecentDocuments
├── reader/     # ReaderHeader, ReadingArea, ParagraphBlock, StudyPanel, StudySheet,
│               #   FocusedAnalysisSheet, TypographyDrawer, DocumentSummary, EditableTitle,
│               #   SpeakerButton, PhoneticWithSpeakers, AudioPlayerBar(朗读播放条)
├── review/     # EditableParagraph(Panel), PageGroup, PDFViewerPanel, ReviewHeader,
│               #   SortableParagraph, UndoRedoToolbar
├── export/     # ExportButton, ExportPreview, ExportSettingsModal/Panel
├── common/     # ApiKeyModal, ProviderSelector, ProtectedRoute, UserMenu,
│               #   PromptEditorModal(死代码)
├── admin/      # AdminLayout, AdminRouteGuard
└── ui/         # 自定义组件库 (Button, Modal, Input, Spinner, Badge, Card, EmptyState 等)
export/         # 导出排版管线: data/blocks/measure/paginate/themes/serializeExportHtml/ExportPages
hooks/          # useSplitPane, useUndoRedo(50步), useResponsiveBreakpoint, useExportPagination,
                #   useParagraphAudioPlayer(段落朗读引擎，模块级单例)
stores/         # authStore, documentStore(文档/段落/翻译/解析全状态), readerStore(persist),
                #   promptStore, exportPreferencesStore, audioPlayerStore(朗读播放状态)
services/       # 每个 API 域一个文件 (authApi/pdfApi/translateApi/wordAnalysisApi/paragraphTtsApi/...)
utils/          # textTokens(token化), ttsAlign(WordBoundary↔词token贪婪对齐), sentenceSections,
                #   phonetic, speak, uuid
```

**关键设计：**
- 无 Ant Design — 全部自定义 `ui/` 组件 + Tailwind CSS
- 暖色调设计系统: `--canvas: #faf9f5`, `--primary: #cc785c`, `--ink: #141413`
- 阅读页桌面端: 左右分栏，拖拽分隔条调宽度；解析面板可 ✕ 关闭 (右侧竖条按钮恢复)；点击已解析单词/句子自动打开面板并定位
- 阅读页移动端: 单栏 + 底部 FAB → StudySheet (45vh 弹出)；已解析内容点击 → FocusedAnalysisSheet (max 45vh)
- 段落渲染: `react-markdown` + `remark-gfm`，单词/句子 token 化注入，支持选中/解析/已解析三种状态
- 分析功能: 前端选中 → API → AI 分析 → upsert 持久化 → 下次打开自动恢复（翻译/单词/句子/总结均持久化）
- **导出**: 前端 `export/` 完成排版分页 (`useExportPagination`) → 序列化 HTML → `POST /pdf/export` 服务端 Chrome 无头渲染；服务器需装 Chrome/Edge 和中文字体（否则乱码），见 `.env.example` 注释
- 认证: JWT 存 localStorage，`ProtectedRoute` 拦截未登录，`AdminRouteGuard` 检查 `is_superuser`
- 错误边界: `ErrorBoundary` 包裹 App，中文提示 + 返回首页

### 自定义 CSS

- `.word-token` — 可点击单词, hover 蓝底
- `.word-token-selected` — 选中状态, 蓝底+光晕
- `.word-token-has-analysis` — 已解析, 绿色虚线底+浅绿背景
- `.sentence-token` / `.sentence-token-selected` / `.sentence-token-has-analysis` — 同单词三态
- `.tts-current-word` / `.tts-current-sentence` — 朗读卡拉OK高亮（当前词/当前句）
- `.sentence-play-btn` — 句子级「从这句朗读」按钮（桌面 hover 显示，触屏常显）
- `.paragraph-flash` / `@keyframes paragraph-flash-anim` — 黄色闪烁 1.5s
- `.word-card-flash` / `.sentence-card-flash` — 解析卡片闪烁定位

## 注意事项

- `ocr.parse_pdf()` / `parse_file()` / `parse_url()` 都是 async，必须 `await`
- `pdf_service.py` 的 `filter_non_content`/`reconstruct_paragraphs` 是 passthrough — 实际过滤在 `OCREngine._content_list_to_paragraphs()`
- Celery tasks 仅在 `celery_app is not None` 时动态定义（`pdf_tasks.py`）；Redis 不可用时 `parse_pdf_task = None`
- 所有 AI 端点接受可选 `api_key` + `system_prompt_override`/`user_prompt_override`；OCR 端点接受 `mineru_token`
- `_SafeDict` 使未知占位符保留原文; `_is_fatal_error()` 区分认证错误（401/403/缺 key）和瞬时错误
- 单词分析防丢失: `_request_word_batch()` + `_missing_words()` 做单词级补偿 — AI 批次返回不全/失败时对缺失单词逐词补发; 补偿仍失败则通过 SSE `incomplete` 事件上报, 前端明确提示缺失单词(绝不静默丢弃)
- 单词分析按**段落分组**(非句子): 同段落单词共享完整段落原文作为上下文 (`{paragraph}` 占位符), 每批 ≤8 词 (`WORDS_BATCH_SIZE`); 兼容旧自定义模板保留 `{sentence}` 占位符(同值填充)
- 全文总结: `POST /summary/stream` 后端自取段落全文（超 `SUMMARY_MAX_CHARS` 按 head 60% + tail 40% 截断），`mode=generate/revise` 区分一键总结与 AI 修改；`summarize_stream` 仅首 chunk 前重试（中途断流重试会重复文本）；草稿由前端 1s 防抖 + 失焦/卸载 flush 到 `PUT /summary/draft`（空白=清空），生成期间暂停保存
- 校对页 `updateParagraphs` 批量保存, `deleteParagraph`/`mergeParagraphs` 自动重排索引; `reorderParagraphs` 同步更新页码。重排/删除用单条 raw `UPDATE` 或临时负索引避免 `UNIQUE (document_id, index)` 冲突
- `PromptEditorModal.tsx` 是死代码 — Prompt 编辑唯一入口在管理后台 `/admin/prompts`
- **DB 迁移陷阱**: 本地 SQLite 库长期保留，启动时 `run_migrations()` 只补登记过的列；新加列需在 `database.py` 里追加 `_apply()` 迁移，否则旧库启动报错
- 后端装了但代码未用的包: `python-docx`, `slowapi`, `aiofiles`；`passlib` 已从 requirements 移除（bcrypt 直连）；`python-jose` 在用（`auth/security.py`）
- `frontend/` 根目录有大量 gitignore 的调试残件（`run_debug*.cjs`, `export_probe*`, `repro*`, `paginate_align_test*` 等），不是功能代码，勿被误导/勿提交
