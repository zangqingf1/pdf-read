import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 后端 API 目标：默认 8000，可用环境变量覆盖（VITE_API_TARGET）
var apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000';
export default defineConfig({
    plugins: [react()],
    server: {
        host: '127.0.0.1', // 只绑 IPv4，避免 localhost 解析为 ::1 导致浏览器无法访问
        port: 5173,
        proxy: {
            '/api': {
                target: apiTarget,
                changeOrigin: true,
            },
        },
        watch: {
            // 忽略编辑器/工具原子保存产生的临时目录与文件。
            // 现象：chokidar 在 Windows 上监听它们会 EBUSY 崩溃 ——
            //   Error: EBUSY: resource busy or locked, watch '....tmpdir\xxx.ts.tmp'
            // 临时目录名形如 `.exportTypes.ts.<pid>.<uuid>.tmpdir`（以 .tmpdir 结尾），
            // 文件形如 `exportTypes.ts.tmp` —— 用正则匹配更可靠。
            ignored: [
                /(^|[/\\])[^/\\]*\.tmpdir([/\\]|$)/i, // 任何 *.tmpdir 目录及其内容
                /\.tmp$/i, // *.tmp 文件
                '**/.git/**',
                '**/node_modules/**',
            ],
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    if (!id.includes('node_modules'))
                        return undefined;
                    if (id.includes('react-pdf') || id.includes('pdfjs-dist'))
                        return 'pdf';
                    if (id.includes('react-markdown') || id.includes('remark-gfm') || id.includes('mdast') || id.includes('micromark') || id.includes('unist'))
                        return 'markdown';
                    if (id.includes('/react/') ||
                        id.includes('/react-dom/') ||
                        id.includes('/react-router') ||
                        id.includes('/scheduler/'))
                        return 'react-vendor';
                    if (id.includes('/axios/') || id.includes('/dayjs/'))
                        return 'http-utils';
                    return undefined;
                },
            },
        },
    },
});
