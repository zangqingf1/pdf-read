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
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
});
