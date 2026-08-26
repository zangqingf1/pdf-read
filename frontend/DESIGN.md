# 设计风格规范（Design Style Guide）

> 本文档从首页与阅读页的实际代码中提取，是全站视觉风格的单一事实来源。
> 新页面 / 新组件请遵循本文档的 token 与配方，不要硬编码 hex。
> Token 定义：`frontend/tailwind.config.js` + `frontend/src/index.css` 的 `:root`。

---

## 1. 设计理念

**暖色纸感（Warm Paper）**：像一本摊开在木桌上的外刊。整体氛围由三层手段构成：

1. **同族暖色的明度层次** —— 层次感靠背景由深到浅逐级提亮实现，不靠重阴影、重边框
2. **衬线标题 + 无衬线正文** 的编辑排版对比
3. **主题色低透明度点缀** —— 交互态全部用 primary 色的 10%~40% 透明度表达，绝不大面积铺色

---

## 2. 颜色 Token

### 2.1 中性色（背景三级提亮）

| Token | 值 | 用途 |
|---|---|---|
| `canvas` | `#faf9f5` | 页面画布（最底层） |
| `canvas-soft` | `#f5f0e8` | 次级底（侧边栏、凹陷面板） |
| `surface-card` | `#f1ece2` | hover 面、进度条槽 |
| `surface-cream-strong` | `#e8e0d2` | 导航激活底、hover 加深 |
| `surface-overlay` | `#fffdf8` | **卡片主体（最高层，最亮）** |

### 2.2 主题色

| Token | 值 | 用途 |
|---|---|---|
| `primary` | `#c87455` | 陶土橙，唯一强调色 |
| `primary-active` | `#a55438` | 按钮 active / hover |
| `on-primary` | 白 | primary 底上的文字 |

### 2.3 文字层级

| Token | 值 | 用途 |
|---|---|---|
| `ink` | `#141413` | 标题、强调文字 |
| `body-strong` / `body` | `#252523` / `#3d3d3a` | 正文 |
| `muted` / `muted-soft` | `#6c6a64` / `#8e8b82` | 次要信息、元数据 |

### 2.4 边框三级（永远 1px）

| Token | 值 |
|---|---|
| `hairline-soft` | `#ebe6df`（默认边框） |
| `hairline` | `#e6dfd8` |
| `hairline-strong` | `#d8cfc4`（虚线上传区等需要更明显处） |

### 2.5 状态色

`success #5db872` · `warning #d4a017` · `error #c64545`

状态横幅配方：`bg-{status}/10 border border-{status}/20 rounded-md text-sm text-{status}`
（淡底 + 细环/细边，不用实心色块；全站统一用 `<ErrorBanner>` 组件）

---

## 3. 圆角与阴影

```
圆角：xs 4px · sm 6px · md 8px · lg 12px · xl 16px · pill 9999px
      大容器卡片 = rounded-xl；列表行/输入框/按钮 = rounded-lg 或 rounded-md；
      图标底座/头像 = rounded-full；底部弹层 = rounded-t-xl
阴影：shadow-soft      卡片标配：0 1px 2px rgba(20,20,19,.04), 0 2px 8px rgba(20,20,19,.06)
      shadow-elevated  弹层/模态：…, 0 16px 40px rgba(20,20,19,.10)
      shadow-float     浮动条（播放条）
      shadow-pop       强调浮层（流式生成卡、悬浮操作条）：带 1px 主色光环 + 柔和投影
      shadow-inset-hairline 内凹描边
```

---

## 4. 字体

| 类 | 字体 | 用途 |
|---|---|---|
| `font-display` | Cormorant Garamond（衬线） | **所有标题、大字、引句的视觉签名** |
| `font-sans` | Inter / system | 默认 UI 文字 |
| `font-chinese` | Noto Sans CJK / PingFang SC | 中文正文段落 |
| `font-mono` | JetBrains Mono | 流式原始输出、技术文本 |

字号纪律：标题 `text-[17px]`~`text-display-*`；辅助文字压到 `text-xs`(12) / `text-[13px]` / `text-[11px]`；
display 系列有 clamp 响应式类（`.text-display-sm/md/lg`），weight 400、负 letter-spacing。

---

## 5. 核心配方（复制即用）

### 5.1 标准大卡片（上传卡、解析卡、每日一句壳）

```tsx
className="bg-surface-overlay border border-hairline-soft rounded-xl shadow-soft overflow-hidden"
// 可选渐变变体（仅用于「英雄卡」，如每日一句）：
"bg-gradient-to-br from-[#fdf4ec] via-[#faf1e6] to-[#f5e6d3]"
```

### 5.2 列表行 / 嵌套卡

```tsx
"group flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-all
 bg-surface-overlay border-hairline-soft hover:shadow-soft hover:border-hairline"
// 选中态："bg-primary/10 border-primary/40"
// 凹陷面板（侧边栏内嵌区）："bg-canvas/80 rounded-xl p-2.5"
```

### 5.3 Eyebrow 标签行（章节签名）

```tsx
<div className="flex items-center gap-3 mb-3">
  <span className="text-[13px] font-semibold text-primary tracking-wide">正在阅读</span>
  <span className="h-px w-12 bg-primary/25" />
</div>
// 居中变体（移动端）：两侧对称短线 h-px w-8 bg-primary/25
```

### 5.4 圆形图标底座

```tsx
<span className="w-9~12 h-9~12 rounded-full bg-primary/10 flex items-center justify-center">
  <svg width="18" height="18" stroke="var(--primary)" ... />
</span>
// 状态换色：成功 bg-success/15 · 失败 bg-error/15 · 警告 bg-warning/15
```

### 5.5 图标规范

全站手写 inline SVG：`strokeWidth 1.4–1.8`、`strokeLinecap/join="round"`、
颜色用 `stroke="var(--primary)"` 或 `currentColor`，禁止引入图标库。

### 5.6 顶栏（sticky header）

```tsx
className="sticky top-0 z-50 h-[52px] px-4 md:px-6 border-b border-hairline-soft backdrop-blur-md ..."
style={{ backgroundColor: 'color-mix(in srgb, ${bg} 88%, transparent)' }}
```

### 5.7 小工具按钮（非 ui/Button 的行内款）

```tsx
"h-8 px-3.5 rounded-md bg-surface-card hover:bg-surface-cream-strong text-xs font-medium transition-colors touch-area"
// 幽灵版："w-8 h-8 rounded-md hover:bg-surface-card text-muted active:scale-95 transition-all"
```

---

## 6. 按钮（统一走 ui/Button，勿手写）

圆角 `rounded-md`，全局 `transition-all active:scale-[0.98]` 微缩按压反馈：

| Variant | 关键类 |
|---|---|
| primary | `bg-primary text-on-primary hover:bg-primary-active shadow-soft` |
| secondary | `bg-canvas text-ink border-hairline hover:border-primary/60 hover:bg-canvas-soft shadow-soft` |
| ghost | `bg-transparent text-ink hover:bg-surface-card/80` |
| danger | `bg-error text-white hover:opacity-90 shadow-soft` |

尺寸：sm `h-8 px-3 text-xs` · md `h-10 px-5 text-sm` · lg `h-12 px-6 text-base`。

危险行内操作（删除）：图标按钮 `text-muted-soft hover:text-error hover:bg-error/5`，
桌面端 `md:opacity-0 md:group-hover:opacity-100`（hover 才显形）；确认态就地展开「删除/取消」小按钮。

---

## 7. 交互状态

| 状态 | 配方 |
|---|---|
| hover 面 | `bg-surface-card` → 加深 `bg-surface-cream-strong` |
| 激活/选中 | `bg-primary/10` 底 或 `border-primary/40` 边 或底部 2px 下划线 tab（`border-b-2 border-primary -mb-[1px]`） |
| focus-visible | 全局 outline 2px primary + offset 2px |
| dragover | `box-shadow: 0 0 0 3px var(--ring)` 主色光环 |
| 进度条 | 槽 `h-1 bg-surface-cream-strong rounded-full` + 填充 `bg-primary` |
| Badge | `rounded-pill px-2.5 py-0.5 text-xs font-medium`，淡底+细环 `bg-x/15 ring-1 ring-x/20` |

---

## 8. 动效

| 动画 | 用途 | 参数 |
|---|---|---|
| `animate-fade-in/out` | 遮罩、整页状态切换 | 0.2s |
| `animate-slide-up` | 卡片入场、Modal/sheet | translateY(8px)+fade, 0.3s |
| `active:scale-[0.98]` | 所有按钮按压反馈 | 150ms |
| 骨架屏 | `.skeleton` shimmer / `animate-pulse`，**固定高度防布局跳动** | 1.5s 循环 |
| 定位闪烁 | `.word-card-flash` 等：主色光环 + 暖底色淡出 | 1.5s ease-out |

遮罩统一 `bg-black/30 backdrop-blur-[2px]`；弹层关闭必须有退场动画（两阶段卸载）。

---

## 9. 细节质感

- 细滚动条：6px、hairline 色 thumb（`.page-selector-grid` 模式）
- 触屏适配：`@media (pointer: coarse)` 下命中区最小 44×44（`.touch-area`）、token padding 加大
- 中文译文引用条：左侧竖条 `border-l-[3px] border-primary` 或独立 `<span className="w-[3px] rounded-full bg-primary/60">`
- 装饰性元素克制使用：巨型引号 SVG（比背景略深的暖色填充）、对角暖色渐变——仅限「英雄卡」

---

## 10. 反模式（禁止）

- ❌ 硬编码 hex（尤其旧主色 `#cc785c`——现为 `#c87455`，一律走 token）
- ❌ 重阴影 / 深色边框做层次
- ❌ 冷色系蓝绿做 UI chrome（正文「已解析词绿/句蓝」高亮是历史保留的功能色，例外）
- ❌ 手写按钮绕过 ui/Button、复制粘贴错误横幅
- ❌ 大面积实心主题色
