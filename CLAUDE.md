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
│   ├── qa.py         # 文档 AI 问答（SSE 多轮对话 + 历史恢复/清空，会话持久化）
│   ├── feedback.py   # 用户问题反馈（multipart 提交+截图 / 我的列表 / 截图鉴权读取）
│   ├── tts.py        # 单词发音 + 段落朗读（edge-tts, 需鉴权）
│   └── admin.py      # 管理后台 API（superuser only）
├── auth/
│   ├── router.py     # 邮箱验证码注册/登录/找回密码/头像/资料 + 登录限流
│   ├── verification.py # 验证码生成/HMAC 哈希/发送(频率限制)/消费(单次+TTL+尝试上限)
│   ├── rate_limit.py # 登录暴力破解限流（进程内，按邮箱+IP）
│   ├── deps.py       # get_current_user / superuser 依赖（新代码从这里 import）
│   ├── security.py   # JWT create/verify + bcrypt（bcrypt 直连，无 passlib）
│   └── schemas.py
├── services/
│   ├── pdf_service.py     # 解析编排 + 文件保存 + URL 源下载
│   ├── ocr_engine.py      # MinerU Cloud（batch file-upload / URL 两条路径）
│   ├── ai_service.py      # DeepSeek: 翻译/单词/句子/总结/文档问答（并发 + 指数退避重试）
│   ├── prompt_defaults.py # 出厂默认 Prompt + PLACEHOLDERS + TEMPLATE_NAMES
│   ├── page_utils.py      # PDF 页数统计 + 页面提取
│   ├── export_service.py  # Chrome 无头渲染 HTML→PDF（零新依赖）
│   ├── tts_service.py     # edge-tts 合成 + 磁盘缓存 + 段落 WordBoundary 词级时间戳
│   ├── file_types.py      # 支持的文件类型/扩展名/MinerU 模型选择（vlm / MinerU-HTML）
│   ├── url_downloader.py  # URL 内容下载
│   ├── email_service.py   # SMTP 发送验证码邮件（标准库 smtplib，强制 TLS 证书校验；开发环境 console 兜底）
│   ├── daily_quote.py     # 每日一句名句库 + 按日期取句（epoch days 取模轮换，无状态）
│   ├── dictionary_service.py # ECDICT 本地词典（音标/释义）+ lookup_exam_tags 考纲标签批量判定
│   ├── srs_service.py     # SRS 调度纯函数（简化 SM-2 四键评分 + 间隔预览，无 DB 依赖可单测）
│   ├── image_upload.py    # 图片上传共用校验（魔术字节白名单 + PIL 重编码去 polyglot 载荷）
│   ├── feedback_service.py # 反馈截图存储（uploads/feedback/，多图 JSON 路径 + 严格前缀校验防穿越）
│   └── avatar_service.py  # 头像保存/删除（复用 image_upload 校验 + 随机文件名）
├── models/   # 每类一文件: user/email_verification/document/paragraph/word_analysis/sentence_analysis/qa_message/prompt_template/daily_quote/feedback
├── schemas/  # 与 api/v1 路由一一对应 + admin
├── tasks/    # celery_app（Redis 不可用→None）+ pdf_tasks（Celery 缺失时降级）
├── config.py     # pydantic-settings (.env)
├── database.py   # engine + get_db + init_db + run_migrations
└── main.py       # lifespan: 建表 → 增量迁移 → 孤儿 processing/awaiting_selection→failed → 每日一句种子
```

**关键决策：**
- DB 默认 SQLite（`backend/pdfreader.db`），Docker 切 PostgreSQL
- 启动自动 `init_db()` 建表 + `run_migrations()` 增量加列（`_migrations` 表去重）。**给既有表加列必须写进 `run_migrations()`**，`create_all` 不会补列
- AI 只接 **DeepSeek**（`DEEPSEEK_MODEL`，默认 `deepseek-v4-flash`），指数退避重试，`Semaphore(settings.AI_CONCURRENCY=15)` 并发；`provider` 参数是预留扩展点（仅 `"deepseek"` 合法）
- **MinerU Token / DeepSeek Key 不在 .env 里配** — 每个用户在前端🔑处自填，随请求传 `mineru_token` / `api_key` 字段。`config.py` 里仍保留 `DEEPSEEK_API_KEY` / `MINERU_API_TOKEN` 两个字段，但**后端业务代码从不读取**（唯一读者是手动冒烟脚本 `scripts/smoke_word_analysis.py`，未配置时自动跳过），因此 `.env` 中这两项保持为空、不要往里写真实密钥
- 解析任务：开发/常规部署走 FastAPI `BackgroundTasks`（`_parse_in_background`）；Celery 仅在 Redis 可用时启用
- `get_db` 依赖注入自动 commit/rollback
- Prompt 两层体系：DB 行有复合主键 `(name, is_default)`；生效优先级 = 自定义 `is_default=False` > 系统默认 `True` > 出厂默认 `prompt_defaults.py`。`_resolve_prompt()` 用 `_SafeDict` + `str.format_map()` 替换占位符
- **邮箱验证码认证**：注册/找回密码均需邮箱验证码。验证码用 `secrets` 生成、HMAC-SHA256（key=SECRET_KEY）哈希入库、`hmac.compare_digest` 常量时间比较；单次使用、10 分钟过期（`EMAIL_CODE_TTL_MINUTES`）、5 次尝试上限（`EMAIL_CODE_MAX_ATTEMPTS`）。**消费与失败计数都是带条件的原子 UPDATE**（`WHERE consumed_at IS NULL` + `rowcount` 判定；计数在 DB 侧自增 `failed_attempts = failed_attempts + 1`）——早期「先 select 再赋值写回」存在 TOCTOU：并发请求会同时通过校验，且丢失更新会让尝试上限形同虚设（6 位码可在 TTL 内爆破）。发送限流：同一邮箱 60s 冷却（`EMAIL_SEND_COOLDOWN_SECONDS`）+ 每小时 5 次（`EMAIL_MAX_PER_HOUR`），另加进程内 IP 10 次/小时。`reset_password` 发送对未知邮箱同样返回成功（防用户枚举）。SMTP 未配置时：开发环境验证码打印日志并在响应返回 `dev_code`，生产环境 503。SMTP 使用 `ssl.create_default_context()` 强制证书校验（不传 context 时 stdlib 默认 `CERT_NONE`，等于不校验、可被中间人窃取授权码），且配置了 `SMTP_USER` 时 `SMTP_SECURITY` 非 `ssl`/`starttls` 直接报错拒绝明文。登录按邮箱+IP 限流（`LOGIN_MAX_ATTEMPTS`/15 分钟，进程内，成功清零），另有按邮箱的全局桶（换 IP/伪造 XFF 也无法绕过）。客户端 IP 识别：`TRUST_PROXY_HEADERS=false`（默认）用 socket 对端地址；仅部署在会清洗 X-Forwarded-For 的可信反代（nginx/Docker 部署已默认 true）后才开启，否则伪造请求头可绕过所有限流
- **头像**：仅接受文件上传（`POST /auth/avatar`），白名单扩展名 + 魔数嗅探（PNG/JPEG/GIF/WebP）+ ≤2MB（`AVATAR_MAX_MB`），随机文件名存 `UPLOAD_DIR/avatars/`，经公开端点 `GET /auth/avatar/{user_id}` 读取；不接收客户端任意 URL 字符串。校验实现已抽到 `app/services/image_upload.py`（与反馈截图**共用同一份**魔术字节白名单 + PIL 重编码，避免两份安全逻辑漂移）
- **每日一句**：名句数据存 `daily_quotes` 表（`text_en`/`text_zh`/`author`/`active`），首次启动自动以内置库（`daily_quote.py` 的 `DAILY_QUOTES`）播种；公开端点 `GET /quote` 按日期序数对 **active** 行取模轮换（同天稳定、跨天自动换），表空时回退内置库。管理后台「句子管理」可增删改/启停
- **问题反馈**：数据存 `feedbacks` 表（`category`/`content`/`contact`/`image_paths`/`status`/`admin_reply`/`replied_at`），**新表由 `create_all` 自动建**（同 `qa_messages` 先例），截图列 `image_paths` 由迁移 `019a` 加列 + `019b` 回填旧单图数据。用户侧 `POST /feedback` 走 multipart（分类 + 正文 + 选填联系方式 + 选填截图**最多 9 张**），截图校验与头像**共用 `app/services/image_upload.py`**（魔术字节白名单 + PIL 重编码丢弃 polyglot 尾部载荷），文件落 `UPLOAD_DIR/feedback/`，上限 `FEEDBACK_MAX_MB=5`/张、`FEEDBACK_MAX_IMAGES=9`/条、`FEEDBACK_MAX_TOTAL_MB=20`/条（**先全量校验再落盘**，被拒时磁盘不留半批文件）。读取走 `GET /feedback/{id}/images/{index}`（0 基索引，**仅提交者本人或超管可取，否则 404 不泄露存在性**），因此前端必须用 `responseType:'blob'` 取回再 `createObjectURL`（不能直接写进 `<img src>`）。提交按用户限流 `FEEDBACK_RATE_LIMIT_PER_HOUR=10`（带截图落盘，按小时防刷 + 防磁盘灌满）。管理员在 `/admin/feedback` 改状态（`pending/processing/resolved/ignored`）与回复；回复非空时写 `replied_at`、清空回复则一并清空；删除反馈连带删除全部截图文件。前端页面：用户 `/feedback`（提交 + 我的反馈列表 + 管理员回复），后台 `/admin/feedback`。测试 `test_feedback.py` 覆盖校验/张数与总量上限/截图归属/索引越界/管理员处理

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/verification-code/send` | 发送邮箱验证码（`purpose=register\|reset_password`，带冷却/频率限制） |
| POST | `/api/v1/auth/register` | 邮箱+验证码注册（用户名可选，返回 JWT 自动登录） |
| POST | `/api/v1/auth/login` | 邮箱+密码登录，返回 JWT（按邮箱+IP 限流） |
| POST | `/api/v1/auth/password-reset/send` | 发送重置密码验证码（未知邮箱也返回成功，防枚举） |
| POST | `/api/v1/auth/password-reset/confirm` | 验证码+新密码（两次）重置密码 |
| GET | `/api/v1/auth/me` | 当前用户信息 |
| PUT | `/api/v1/auth/profile` | 更新用户名 |
| POST | `/api/v1/auth/avatar` | 上传/更换头像（multipart，白名单+魔数校验） |
| DELETE | `/api/v1/auth/avatar` | 删除头像 |
| GET | `/api/v1/auth/avatar/{user_id}` | 获取头像图片（公开端点） |
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
| POST | `/api/v1/words/syllabus-match` | 考纲标注批量匹配（ECDICT 离线，无 AI；阅读页高亮用） |
| GET | `/api/v1/words/list/{document_id}` | 单词解析列表 |
| DELETE | `/api/v1/words/{analysis_id}` | 删除单词解析 |
| POST | `/api/v1/sentences/analyze` | 句子解析 (upsert) |
| POST | `/api/v1/sentences/stream` | 句子解析（SSE） |
| GET | `/api/v1/sentences/list/{document_id}` | 句子解析列表 |
| DELETE | `/api/v1/sentences/{analysis_id}` | 删除句子解析 |
| POST | `/api/v1/summary/stream` | 全文总结/修改（SSE，后端自取正文） |
| PUT | `/api/v1/summary/draft` | 保存总结草稿（空白=清空） |
| POST | `/api/v1/qa/stream` | 文档 AI 问答（SSE，多轮，服务端取历史/全文/引用段上下文，done 后落库） |
| GET | `/api/v1/qa/messages/{document_id}` | 恢复某文档的问答对话（按插入顺序） |
| DELETE | `/api/v1/qa/messages/{document_id}` | 清空某文档的问答对话 |
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
| GET | `/api/v1/quote` | 每日一句（公开，按日期确定性取句：en + zh + author + date） |
| GET | `/api/v1/srs/queue` | SRS 今日到期复习卡（学习卡优先，含四键间隔预览 + 各类计数） |
| POST | `/api/v1/srs/review` | 提交复习评分（0=忘了/1=困难/2=良好/3=简单，SM-2 调度落库） |
| POST | `/api/v1/srs/{entry_id}/mastered` | 标记/取消掌握（取消直接回队列） |
| POST | `/api/v1/srs/{entry_id}/reset` | 重置调度为新卡 |
| GET | `/api/v1/srs/stats` | 复习统计（今日到期/已复习/已掌握 + 未来7天预测） |
| POST | `/api/v1/feedback` | 提交问题反馈（multipart：分类+正文+选填联系方式/截图最多 9 张，按小时限流） |
| GET | `/api/v1/feedback/mine` | 我的反馈列表（含状态与管理员回复，分页） |
| GET | `/api/v1/feedback/{feedback_id}/images/{index}` | 反馈截图第 index 张（0 基，仅提交者本人或管理员，需鉴权） |
| GET | `/api/v1/admin/stats` | 管理统计 |
| GET | `/api/v1/admin/users` | 用户列表 |
| PUT | `/api/v1/admin/users/{user_id}` | 编辑用户 |
| DELETE | `/api/v1/admin/users/{user_id}` | 删除用户 |
| GET | `/api/v1/admin/documents` | 全部文档列表 |
| POST | `/api/v1/admin/documents/batch-delete` | 批量删除文档 |
| DELETE | `/api/v1/admin/documents/{doc_id}` | 删除单个文档 |
| GET | `/api/v1/admin/quotes` | 名句列表（搜索/启停过滤/分页） |
| POST | `/api/v1/admin/quotes` | 新增名句 |
| PUT | `/api/v1/admin/quotes/{quote_id}` | 编辑名句（部分更新，含启停） |
| DELETE | `/api/v1/admin/quotes/{quote_id}` | 删除名句 |
| GET | `/api/v1/admin/feedback` | 反馈列表（搜索内容/联系方式/邮箱 + 状态过滤 + 分页） |
| PUT | `/api/v1/admin/feedback/{feedback_id}` | 更新反馈状态 / 写管理员回复 |
| DELETE | `/api/v1/admin/feedback/{feedback_id}` | 删除反馈（连带删除截图文件） |
| GET | `/health` | 健康检查 |

**Prompt 模板**: 六种 (`translate`, `analyze_words`, `analyze_sentences`, `summary`, `doc_qa`, `doc_quiz`) 全部可编辑。`_VALID_NAMES` 从 `DEFAULT_PROMPTS.keys()` 动态派生。

### 数据模型

- **User**: `email`(unique), `nickname`, `avatar_url`（存 `avatars/xxx` 相对路径）, `password_hash`, `is_superuser`, `is_active`, `created_at`
- **EmailVerification**: 邮箱验证码记录（注册/重置密码）。仅存 `code_hash`（HMAC-SHA256，key=SECRET_KEY），`expires_at` 到期、`failed_attempts` 超限或 `consumed_at` 消费后即失效（单次使用）
- **Document**: UUID 主键, `parse_status` (pending→awaiting_selection(仅PDF)→processing→completed/failed), cascade delete。另有 `title_zh`（大标题中文翻译）、`source_type`(`upload`/`url`)、`file_ext`、`source_url`、`summary`+`summary_updated_at`（草稿与 AI 结果共用一列）。`original_text`/`word_count`/`paragraph_count` 为聚合字段，编辑后在后端重算
- **Paragraph**: `(document_id, index)` 唯一索引, `text_en`, `text_zh`, `page_number`, `bbox_json`（英文变更→译文清空待重译）。`bbox_json` 存 MinerU 布局坐标 JSON `{"box":[x1,y1,x2,y2], "pts_w":.., "pts_h":..}`（PDF 源才有；box 为 MinerU 渲染图像像素，pts_w/pts_h 为 pypdf 读的该页 PDF 点数尺寸，前端据此把框映射到 react-pdf 渲染坐标，见注意事项「PDF 布局解析框」）
- **WordAnalysis**: `(document_id, paragraph_index, word)` 唯一, upsert。含 phonetic, definition, cognates, synonyms_antonyms, exam_tags（考纲标签 JSON 数组）等
- **SentenceAnalysis**: `(document_id, paragraph_index, sentence_index)` 唯一, upsert。含 `structure_json`（新格式 `{"content": ...}`，旧格式向前兼容重建）
- **PromptTemplate**: **复合主键 `(name, is_default)`**, `system_prompt` + `user_prompt`。无 DB 行=出厂默认
- **QaMessage**: 文档 AI 问答对话（多轮持久化）。**自增整数主键**（对话按插入顺序回放，UUID 无单调性），`document_id` cascade delete, `role`(user/assistant), `content`, `prompt_name`(assistant 行记录所用模板), `paragraph_index`(引用句所在段落, nullable), `sentence_index`(引用句在段内的句子索引, user 行, nullable, 迁移 `017a`), `sentence_text`(引用句原文, user 行, nullable, 迁移 `017b`), `created_at`。新表由 `create_all` 自动建，但**既有表加列必须登记迁移**
- **DailyQuote**: 每日一句名句库（管理后台「句子管理」维护）。`text_en`/`text_zh`/`author`/`active`(启停)/`created_at`；`GET /quote` 按日期序数对 active 行取模轮换
- **Feedback**: 用户问题反馈。**自增整数主键**（列表按提交顺序倒序），`user_id` cascade delete, `category`(bug/feature/content/other), `content`, `contact`(选填), `image_paths`(选填，JSON 数组文本，最多 `FEEDBACK_MAX_IMAGES=9` 个 `feedback/<user>-<hex>.<ext>` 相对路径；旧库的单列 `image_path` 由迁移 `019b` 回填为单元素数组), `status`(pending/processing/resolved/ignored), `admin_reply`(选填), `replied_at`(有回复才有), `created_at`/`updated_at`；索引 `(user_id, id)` 与 `(status, id)`。**新表由 `create_all` 自动建**；`image_paths` 属于既有表加列，登记在迁移 `019a`

### 解析流程

1. 上传文件（`file_types.SUPPORTED_UPLOAD_EXTENSIONS` 白名单，≤50MB）或 URL → `pdf_service` 落盘/下载
2. 仅 PDF 有「页」概念：upload 响应直接返回 `page_count` → 前端 `PageSelector` (react-pdf 缩略图) 选页（≤10）→ `select-pages`；非 PDF / URL 源跳过选页直接解析
3. MinerU：文件走 batch file-upload API；HTML 扩展名用 `MinerU-HTML` 模型；URL 走 `parse_url`（网页用 MinerU-HTML 服务端抓取）
4. 下载 zip → `content_list.json` 优先, `full.md` 回退
5. `_map_page_numbers()` 将 MinerU 0-based 索引映射回原文档页码

### 前端 (React 18 + TypeScript + Zustand + Tailwind CSS)

```
pages/          # Home/Reader/Review/Login/Register/ForgotPassword/Profile/Feedback + admin/ (Dashboard/Users/Documents/Prompts/Quotes/Feedback)
components/
├── home/       # DailyQuote, PDFUploader, PageSelector, RecentDocuments
├── reader/     # ReaderHeader, ReadingArea, ParagraphBlock, StudyPanel, StudySheet,
│               #   QAPanel(AI 问答对话面板), FocusedAnalysisSheet, TypographyDrawer, DocumentSummary,
│               #   EditableTitle, SpeakerButton, PhoneticWithSpeakers, AudioPlayerBar(朗读播放条)
├── review/     # EditableParagraph(Panel), PageGroup, PDFViewerPanel(布局解析框),
│               #   ReviewHeader, UndoRedoToolbar
├── export/     # ExportButton, ExportPreview, ExportSettingsModal/Panel
├── common/     # ApiKeyModal, ProviderSelector, ProtectedRoute, EntryRoute, PublicOnlyRoute, UserMenu,
│               #   PromptEditorModal(死代码)
├── admin/      # AdminLayout, AdminRouteGuard
└── ui/         # 自定义组件库 (Button, Modal, Input, Spinner, Badge, Card, EmptyState 等)
export/         # 导出排版管线: data/blocks/measure/paginate/themes/serializeExportHtml/ExportPages
hooks/          # useSplitPane, useUndoRedo(50步), useResponsiveBreakpoint, useExportPagination,
                #   useParagraphAudioPlayer(段落朗读引擎，模块级单例)
stores/         # authStore, documentStore(文档/段落/翻译/解析全状态), readerStore(persist),
                #   qaStore(AI 问答会话), promptStore, exportPreferencesStore, audioPlayerStore(朗读播放状态)
services/       # 每个 API 域一个文件 (authApi/pdfApi/translateApi/wordAnalysisApi/paragraphTtsApi/feedbackApi/...)
utils/          # textTokens(token化), ttsAlign(WordBoundary↔词token贪婪对齐), sentenceSections,
                #   phonetic, speak, uuid
constants/      # examTags(考纲标签常量/配色/显隐过滤), feedback(反馈分类/状态元数据)
```

**关键设计：**
- 无 Ant Design — 全部自定义 `ui/` 组件 + Tailwind CSS
- 暖色调设计系统: `--canvas: #faf9f5`, `--primary: #cc785c`, `--ink: #141413`
- **阅读页考纲标注**: 排版抽屉「考纲标注」多选（readerStore `syllabusTags` 持久化，与解析卡片的 `visibleExamTags` 显隐过滤完全独立）。`useSyllabusHighlight` 收集全文去重词元 → `POST /words/syllabus-match` 后端 ECDICT 离线判定（含屈折还原）→ 命中集合存 documentStore `syllabusWords`（+`syllabusVersion` 供 SentenceToken 签名感知），token 命中加 `.word-token-syllabus`（琥珀虚线下划线）。按「文档+考纲组合+正文指纹」模块级缓存，编辑正文后自动补查新词；失败静默降级不影响阅读。仅阅读页生效（校对页/导出不标）
- 阅读页桌面端: 左右分栏，拖拽分隔条调宽度；右侧面板在「解析 / AI 问答」间 Tab 切换（同一滑入滑出容器，ReaderHeader 对话图标 / 浮动操作条「问 AI」进入），可 ✕ 关闭 (右侧竖条按钮恢复)；点击已解析单词/句子自动打开面板并定位（反方向：点面板卡片里的词/句标题回跳原文，段落闪动 + 该词/句 token 精确闪动 1.8s —— `scrollToParagraph({word})` / `scrollToSentence()` 内部给 token 加 `.word-token-jump-flash` / `.sentence-token-jump-flash`，同一目标连续点击会重置定时器重播动画）
- 阅读页移动端: 单栏 + 底部双 FAB（解析 / AI 问答）→ StudySheet (45vh 弹出，内容按 Tab 切换)；已解析内容点击 → FocusedAnalysisSheet (max 45vh)
- 段落渲染: `react-markdown` + `remark-gfm`，单词/句子 token 化注入，支持选中/解析/已解析三种状态。**段内手动换行（校对页回车）按原文还原**：`splitSentences` 返回 `breaksBefore` 承接被切句正则消费掉的句间换行，段落渲染按其数量插 `<br/>`（双击回车 = 空行），句内换行由空白 token 在 `renderWordTokens` 转 `<br/>`（Markdown 软换行走同一路径），与校对页 `whitespace-pre-wrap` 的换行显示一致。**句子索引与送给 AI 的句子文本一律不变**（`index` 语义漂移会让存量 `SentenceAnalysis` 错位）；段尾换行不渲染；导出 PDF 仍按空格归一（`paragraphNormText`）
- 分析功能: 前端选中 → API → AI 分析 → upsert 持久化 → 下次打开自动恢复（翻译/单词/句子/总结均持久化）
- **文档 AI 问答（外刊精读）**: 阅读页右侧面板 Tab「AI 问答」（移动端 StudySheet 内容切换），多轮对话由后端持久化（`qa_messages` 表，自增 id 保证回放顺序；**done 时才落库 user+assistant 两条**，流中断不留孤儿行）。`POST /qa/stream` 服务端组装 messages：system = prompt 模板（`doc_qa` 问答 / `doc_quiz` 出题批改，占位符含 `{document_title}/{document_text}/{target_sentence}/{paragraph_context}`，system 部分由端点用 `_SafeDict` 显式格式化——`_resolve_prompt` 只格式化 user 部分）+ 最近 `QA_HISTORY_MESSAGES=20` 条历史 + 当前问题；全文截断复用 summary 的 head 60% + tail 40%（`QA_MAX_CHARS=24000`）。入口：浮动操作条「问 AI」（选中句子 → 引用句卡片 + 快捷问题 chips）/ ReaderHeader 对话图标 / 移动端聊天 FAB；「出 3 道阅读理解题」chip 走 `doc_quiz`，用户作答后同对话批改。前端 `qaStore` 内存态（临时负 id，成功后本地追加 assistant 消息），切文档懒加载历史、卸载 reset。**引用句精确跳转**：引用卡（`QuoteChip`）带 `sentence_index`/`sentence_text` 落库（迁移 `017a/017b`），点击后由阅读页容器 `onJumpToQuote` 调 `scrollToSentence()` 精确居中该句（`[data-paragraph-index] .sentence-token[data-sentence-index]`，找不到时重试后回退整段定位），并把定位句写入 `documentStore.quoteLocate` 持续高亮（`.sentence-token-located`，点击正文其他位置 `onPointerDown` 清除）；旧历史数据无句级字段则整段定位。移动端先收 StudySheet 再定位（等 350ms 收起动画）
- **SRS 间隔重复复习**: 单词本全部条目自动成为复习卡（`vocabulary_entries` 上的 `srs_*` 列，迁移 016a~016h；`srs_due_at` NULL = 新卡即到期）。简化 SM-2 四键评分（`srs_service.next_state` 纯函数）：忘了/困难 → 10 分钟学习步；良好 → 毕业 1 天；简单 → 4 天；复习阶段 间隔×ease（困难 ×1.2、简单 ×1.3 加成），遗忘 ease−0.20 进重学；ease 夹 [1.3,3.0]，间隔 ≥21 天自动 `status='mastered'` 出队列。前端 `/srs` 翻卡页（空格翻面、键盘 1-4 评分、间隔预览仅展示、调度以后端为准），入口在 UserMenu（带到期角标）/首页快捷区/单词本「去复习」；单词本卡片显示 新词/复习中/已掌握 徽标 + 掌握切换按钮。`srs_last_reviewed_at` 供「今日已复习」统计；`GET /srs/stats` 含未来 7 天到期预测。v1 未联动阅读页高亮（已掌握词仍显示已解析样式）
- **问题反馈**: 用户 `/feedback` 独立页（ProtectedRoute，入口在 UserMenu「问题反馈」）—— 分类分段按钮 + 正文 + 选填联系方式 + 选填截图（`multiple` 多选，最多 9 张；本地缩略图预览、逐张可移除、单张 5MB 与合计 20MB 前置校验），提交成功内联绿色 banner 并刷新下方「我的反馈」列表（状态徽标 + 管理员回复块 + 「查看截图（N）」）。截图统一由共用组件 `components/common/FeedbackImageGallery.tsx` 展示（主图 + 缩略图条，按索引懒加载缓存 blob、卸载时释放 URL；两处调用点都传 `key={feedbackId}` 避免跨反馈复用缓存）。后台 `/admin/feedback`：搜索（内容/联系方式/邮箱/昵称，300ms 防抖）+ 状态筛选按钮组 + 移动端卡片/桌面表格双视图 + 分页；「处理」弹窗内改状态、看截图并写回复，删除需二次确认。**反馈截图端点需鉴权**，前端用 `responseType:'blob'` 取回后 `URL.createObjectURL`；全程不用 toast/alert（沿用内联错误提示惯例）
- **导出**: 前端 `export/` 完成排版分页 (`useExportPagination`) → 序列化 HTML → `POST /pdf/export` 服务端 Chrome 无头渲染；服务器需装 Chrome/Edge 和中文字体（否则乱码），见 `.env.example` 注释
- 认证: JWT 存 localStorage，`ProtectedRoute` 拦截未登录，`AdminRouteGuard` 检查 `is_superuser`
- **入口路由（欢迎页 / 登录页顺序）**: `/` 是入口闸门 `EntryRoute` — 已登录 → 主页 `HomePage`；首次访问（`localStorage['landing_visited']` 未置位）→ `/welcome` 欢迎页；看过欢迎页但未登录 → `/login`。标记由 `LandingPage` 挂载时 `markLandingVisited()` 写入（`services/visitStorage.ts`，读写均 try/catch，隐私模式降级为「每次都是首次」），**必须写在欢迎页真的渲染出来时** —— 写进闸门判定里会让首次用户一落 `/` 就被标记，刷新后直接进登录页、再也看不到欢迎页。`/welcome`、`/login`、`/register`、`/forgot-password` 四个公开路由包 `PublicOnlyRoute`（已登录 → 主页，避免已登录用户看到登录表单），未知路径由 `*` 兜底到 `/` 走闸门（此前是空白页）
- 错误边界: `ErrorBoundary` 包裹 App，中文提示 + 返回首页

### 自定义 CSS

- `.word-token` — 可点击单词, hover 蓝底
- `.word-token-selected` — 选中状态, 蓝底+光晕
- `.word-token-has-analysis` — 已解析, 绿色虚线底+浅绿背景
- `.sentence-token` / `.sentence-token-selected` / `.sentence-token-has-analysis` — 同单词三态
- `.sentence-token-located` — 问答引用句定位高亮（暖橙底 + primary 描边），独立于 `-selected`（不触发浮动操作条）
- `.tts-current-word` / `.tts-current-sentence` — 朗读卡拉OK高亮（当前词/当前句）
- `.sentence-play-btn` — 句子级「从这句朗读」按钮（桌面 hover 显示，触屏常显）
- `.paragraph-flash` / `@keyframes paragraph-flash-anim` — 黄色闪烁 1.5s
- `.word-card-flash` / `.sentence-card-flash` — 解析卡片闪烁定位
- `.word-token-jump-flash`（暖橙）/ `.sentence-token-jump-flash`（暖黄）— 反向定位：从解析卡片跳回原文时，正文里对应单词/句子 token 闪动 1.8s（词/句用不同色系，避免与 `.sentence-token-located` 的暖橙持续高亮混淆）

## 注意事项

- `ocr.parse_pdf()` / `parse_file()` / `parse_url()` 都是 async，必须 `await`
- `pdf_service.py` 的 `filter_non_content`/`reconstruct_paragraphs` 是 passthrough — 实际过滤在 `OCREngine._content_list_to_paragraphs()`
- **OCR 后处理**：`text_cleanup.py` 的 `clean_ocr_text()` 在解析落库前做保守确定性清洗（断行连字 `con-\ntinue`、连字字符 `ﬁ/ﬂ`、弯引号、短破折号、NBSP、零宽/替换符、控制字符、标点前空格、重复标点；省略号 `...` 保护、`\u2014` 长破折号保留、表格 HTML 不清洗），幂等零成本，重复解析不会叠加变形
- Celery tasks 仅在 `celery_app is not None` 时动态定义（`pdf_tasks.py`）；Redis 不可用时 `parse_pdf_task = None`
- **MinerU Token 前置校验**：解析全程依赖用户自填的 MinerU Token（不在服务端配置）。四个解析入口 —— `/pdf/upload`、`/pdf/parse-url`、`/pdf/select-pages`、`/pdf/retry` 的非 PDF 分支 —— 在保存文件 / 建文档 / 改状态 / 起后台任务**之前**调用 `_require_mineru_token()`，缺失即 400 + `MINERU_TOKEN_MISSING` 提示（测试 `test_mineru_token_guard.py` 锁死接线）。此前缺 Token 会先返回成功、再由后台任务把文档置为 failed，用户只看到笼统的「解析失败」。`/pdf/retry` 对 `awaiting_selection` 文档仍放行（只是回传页数让前端回到选页）。前端 `PDFUploader` 在进入上传/解析前同样守卫：内联错误条 + 自动打开 API 配置弹窗（`onRequireApiKey`）——因为 `setToast` / `setRecentToast` 这类 toast 通知**从未被接入**（全项目无调用方），错误必须内联可见；`RecentDocuments` 的失败提示同理写在 `actionError` 里- 所有 AI 端点接受可选 `api_key` + `system_prompt_override`/`user_prompt_override`；OCR 端点接受 `mineru_token`
- `_SafeDict` 使未知占位符保留原文; `_is_fatal_error()` 区分认证错误（401/403/缺 key）和瞬时错误
- 单词分析防丢失: `_request_word_batch()` + `_missing_words()` 做单词级补偿 — AI 批次返回不全/失败时对缺失单词逐词补发; 补偿仍失败则通过 SSE `incomplete` 事件上报, 前端明确提示缺失单词(绝不静默丢弃)
- 单词分析按**段落分组**(非句子): 同段落单词共享完整段落原文作为上下文 (`{paragraph}` 占位符), 每批 ≤8 词 (`WORDS_BATCH_SIZE`); 兼容旧自定义模板保留 `{sentence}` 占位符(同值填充)
- **考纲标签** (`exam_tags`): 后端落库时用本地 ECDICT 确定性生成，与 AI 无关。`dictionary_service.lookup_exam_tags()` 批量查 `tag` 列 8 种原生标签（`zk`初中/`gk`高中/`cet4`四级/`cet6`六级/`ky`考研/`ielts`雅思/`toefl`托福/`gre`GRE；无派生标签），屈折变化词兜底到原形（`went`→`go`）；固定顺序输出，进程内缓存。单词本 `batch-add` 对全部词直查 ECDICT 落标签（WordAnalysis 搬运值仅兜底）；存量条目由启动迁移 `014c_vocab_exam_tags_backfill` 全量重算回填。前端 `constants/examTags.ts` + readerStore `visibleExamTags`（默认全选）+ `ExamTagFilterPopover` 控制阅读页/单词本/导出 PDF 三层展示
- 全文总结: `POST /summary/stream` 后端自取段落全文（超 `SUMMARY_MAX_CHARS` 按 head 60% + tail 40% 截断），`mode=generate/revise` 区分一键总结与 AI 修改；`summarize_stream` 仅首 chunk 前重试（中途断流重试会重复文本）；草稿由前端 1s 防抖 + 失焦/卸载 flush 到 `PUT /summary/draft`（空白=清空），生成期间暂停保存
- 校对页 `updateParagraphs` 批量保存, `deleteParagraph`/`mergeParagraphs` 自动重排索引; `reorderParagraphs` 同步更新页码。重排/删除用单条 raw `UPDATE` 或临时负索引避免 `UNIQUE (document_id, index)` 冲突（前端已移除拖拽重排 UI，`/reorder` 接口保留未用）
- **PDF 布局解析框**：`_content_list_to_paragraphs` 提取 MinerU 块 `bbox`（list 取 item 并集；5 元素带置信度格式取前 4；缺省为 None）→ `ParsedDocument.paragraph_bboxes` → `pdf_service` 用 pypdf 读该页 `mediabox` 点数尺寸写入 `Paragraph.bbox_json`（迁移 `010a_paragraphs_bbox_json`，`{"box":[...], "pts_w":.., "pts_h":..}`，另存每页渲染 `scale`）→ `GET /result` 每段返回 `layout`。**前端坐标换算以「文本自校准」为主**（`PDFViewerPanel` 用 pdfjs `getTextContent` 提取真实文本位置，把段落框与文本做线性拟合，得到「MinerU 图像像素 → CSS 像素」的仿射映射 `css = f·box + c`，`fitLineRobust` 带离群点剔除。匹配算法对任意栏数稳健：每页先用「段落框内容范围 ↔ 文本行内容范围」自举映射，每个段落框映射后外扩 20% 取相交文本行为候选，候选行按 x 空隙链式分组（局部栏）后按组大小降序逐一匹配（`buildTextLines` + `groupLinesByX`，无全局分栏假设——旧版硬编码两栏导致三栏/窄栏距文档整篇偏移）；**MinerU Cloud 的 bbox 实际落在约 1000×1000 正方形坐标空间（x/y 缩放不同，如 fx≈0.92、fy≈1.24），存储的 scale（200dpi 假设）对其无效**，必须从真实文本反推 fx/fy/cx/cy；非 Cloud 文档同样适用（fx≈fy）。校准记录 `refW`，换宽度时按 `pageWidth/refW` 等比缩放，框随 PDF 一起变大变小）；自校准失败才回退 `bboxToCss`（先检测归一化空间：box 坐标 ≤~1100 且 `pts_w×scale` 远大于该范围 → 按 `box/1000 × 页宽` 换算；否则 `css = box × renderWidth / (pts_w × scale)`，无 scale 时 `MINERU_BBOX_DPI=200` 常量）。校对页已改文档式显示（无卡片、无拖拽），段落悬浮显示蓝色线框 + 图标条（修订/合并下一段/删除，CSS `group-hover` 控制显隐且 `mt-0` 紧贴段落避免空隙导致 hover 中断），PDF 预览页叠加布局框。**布局框交互**：直角细线无填充，鼠标移过才填充（整体垂直微调偏移 `BOX_V_OFFSET`，正值向下）；悬浮框联动高亮对应段落（不跳转）；**点击框 → 编辑区段落滚动居中并暖黄闪烁高亮**（`review-paragraph-flash`）；**点击段落 → 对应框滚动到 PDF 预览居中并蓝色闪烁高亮**（`layout-box-flash`，移动端自动切到 PDF 标签页，`focusRequest` 用 `{index,t}` 递增触发 + `numPages` 依赖兜底等 PDF 加载完成再定位）。**布局框与段落同步**：`paragraphLayouts` 与 `paragraphs` 同源并行维护，删除段落 → 对应框删除、后续索引前移；合并段落 → 同页两框并集（`mergeLayoutItems`，跨页仅保留前框）后续索引前移；**布局框纳入 undo/redo 快照**（`useUndoRedo` 的 `UndoableSnapshot.layouts`，`pushSnapshot` 同步保存），撤销/重做时框随段落一起恢复/重做，对应关系始终正确
- `PromptEditorModal.tsx` 是死代码 — Prompt 编辑唯一入口在管理后台 `/admin/prompts`
- **DB 迁移陷阱**: 本地 SQLite 库长期保留，启动时 `run_migrations()` 只补登记过的列；新加列需在 `database.py` 里追加 `_apply()` 迁移，否则旧库启动报错
- **安全加固（2026-09）**：导出的待渲染 HTML 来自用户，视为不可信。**文档源必须是绑定 `127.0.0.1` 的一次性回环 HTTP 服务**（`_ExportHtmlServer`：临时端口 + 随机 token，只认该路径，绑定失败直接报错不降级），**绝不能再改回 `file://`** —— `file://` 源下用户 HTML 里的 `<iframe src="file:///…">` 能把服务器任意本地文件（`.env`、SQLite 库）渲染进返回的 PDF，实测可读出 `SECRET_KEY`/`SMTP_PASSWORD` 等并进而伪造 JWT。CSP 由该 HTTP 响应头下发（`default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:`），脚本/子框架/外链/connect 全部被禁；禁网靠 `--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1`（**缺 `EXCLUDE` 会连回环服务一起禁掉、渲染产出 0 字节 PDF**）+ `--disable-background-networking`。注意 **`--disable-javascript` 在 `--headless=new` 下已失效**（实测脚本仍会执行），已移除，脚本拦截靠上面的 CSP；`--blink-settings=scriptEnabled=false` 不可用（实测同样产出 0 字节 PDF）；`--no-sandbox` 保留（容器化部署依赖它，残余风险已知）。AI/导出/考纲匹配端点按用户限流（`AI_RATE_LIMIT_PER_MIN=30` / `EXPORT_RATE_LIMIT_PER_MIN=10` / `SYLLABUS_MATCH_RATE_LIMIT_PER_MIN=30`，进程内滑动窗口，实现 `app/utils/rate_limit.py`，以 `app/api/deps.py` 的 `ai_rate_limit`/`export_rate_limit`/`syllabus_rate_limit` 依赖挂到路由上，测试 `test_rate_limit.py` 锁死接线）；反馈提交按用户 10 次/小时限流（`FEEDBACK_RATE_LIMIT_PER_HOUR`，带截图落盘，`_user_rate_limit` 工厂支持传 `window_seconds`），截图另有 `FEEDBACK_MAX_IMAGES=9` / `FEEDBACK_MAX_TOTAL_MB=20` 双重上限防单请求灌满磁盘；TTS 端点有每用户 60 次/分钟限流（`TTS_RATE_LIMIT_PER_MIN`），磁盘缓存 `.tts_cache` 上限 `TTS_CACHE_MAX_MB=200` 超限按 mtime 淘汰；`/health` 不返回 `environment`；`DEBUG` 默认 `false`
- **请求列表长度上限**：`WordAnalysisRequest.entries`(1000)、`SentenceAnalysisRequest.entries`(2000)、`TranslateRequest.paragraphs`/`indices`(2000)、`VocabularyBatchAddRequest.words`(5000)、`VocabularyBatchDeleteRequest.ids`(1000)、`UpdateParagraphsRequest.paragraphs`/`ReorderParagraphsRequest.ordered_indices`(2000)。前端对整篇文档**一次性发送、不分片**，所以上限按整篇文档量级取值；真实文档超限会返回 422 —— 需要支持更大文档时先给前端加分片，不要默默放宽上限
- **按用户限流与并发信号量的关系**：`ai_service` 的 `AI_CONCURRENCY`(15) 与 `export_service` 的 `PDF_EXPORT_CONCURRENCY`(2) 都是**进程级全局**信号量，没有按用户配额时单个用户开几个大请求就能占满全部槽位饿死其他用户。限流状态在进程内，多副本部署需换 Redis 才能共享
- **配置读取陷阱**: `Settings` 的 `env_file=".env"` 是 **CWD 相对路径** — 本地 `cd backend` 启动时读的是 `backend/.env`，不是仓库根目录的 `.env`（根 `.env` 仅供 docker-compose 变量替换）。SMTP/密钥等本地配置必须写在 `backend/.env`（两者已同步）
- **进程与代码同步**: 本地启动必须带 `--reload`（`uvicorn app.main:app --reload --port 8000`），否则代码改动后运行中的服务仍是旧路由（典型症状：接口 404 `{"detail":"Not Found"}`）。用 `Start-Process` 脱管启动（日志重定向到 `backend/uvicorn.{out,err}.log`）可避免会话结束连带杀掉后端
- 后端装了但代码未用的包: `python-docx`, `slowapi`, `aiofiles`；`passlib` 已从 requirements 移除（bcrypt 直连）；`python-jose` 在用（`auth/security.py`）
- `frontend/` 根目录有大量 gitignore 的调试残件（`run_debug*.cjs`, `export_probe*`, `repro*`, `paginate_align_test*` 等），不是功能代码，勿被误导/勿提交
- **下载外部大文件（GitHub 等）的约定**: 本机直连 GitHub 内容下载（`raw.githubusercontent.com`、release 的 `objects.githubusercontent.com`）会被重置/超时；唯一可用的镜像 `ghproxy.net` 限速严重（~0.05 MB/s）。因此**遇到需要下载的 GitHub 文件，不要自己硬下**，直接把仓库/直链告诉用户，由用户自行下载（迅雷/代理更快）后放到指定路径，再继续后续处理
- **Git 提交/同步约定**: 本工作区（`D:\C++\English PDF read`）的 remote 是 `git@github.com:zangqingf1/pdf-read.git`。用户要求"更新到 git / 提交"时：在本工作区 commit 后 **push 到 origin**，再到部署克隆目录 `D:\33294\github\pdf-read` 执行 `git pull origin master` 同步（该目录 remote 是 https 同一仓库，是用户实际使用的发布目录）
- **nginx 部署注意（宿主 nginx / rpm 系）**: `.mjs` 必须映射为 JavaScript MIME（`types { application/javascript mjs; }`，见 `pdfreader.conf` 模板），否则 pdf.js worker 以 `application/octet-stream` 返回时 Chrome 拒绝加载 → 上传选页/校对预览报「预览加载失败」；worker 资源建议 `Cache-Control: no-cache, no-store`（防浏览器沿用旧 MIME 响应）。ECDICT 大库建议建 `lower(word)` 函数索引（考纲匹配用 `WHERE lower(word) IN (...)`，无索引即全表扫描 340 万行，2 核小机秒级 → 索引后几十 ms，语句: `CREATE UNIQUE INDEX idx_stardict_lower_word ON stardict(lower(word))`）
