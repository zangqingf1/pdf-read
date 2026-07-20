#!/bin/bash
# ============================================================
# PDF 外刊阅读工具 — 在线更新脚本
# 从 GitHub 拉取最新代码，重新构建前端，重启后端
# ============================================================
set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_step()  { echo -e "\n${CYAN}>>> $1${NC}"; }

cd /opt/pdf-reader

log_step "Step 1: 拉取最新代码"
git pull origin master
log_info "代码已更新到 $(git log --oneline -1)"

log_step "Step 2: 重启后端服务"
systemctl restart pdfreader
sleep 2

if systemctl is-active --quiet pdfreader; then
    log_info "后端服务运行正常"
else
    echo "⚠ 后端启动失败，查看日志: journalctl -u pdfreader -n 30 --no-pager"
    exit 1
fi

log_step "Step 3: 健康检查"
HEALTH=$(curl -s http://localhost/health)
echo "  $HEALTH"

echo ""
echo "  ╔══════════════════════════╗"
echo "  ║   ✅ 更新完成！           ║"
echo "  ╚══════════════════════════╝"
echo ""
log_info "如果前端代码也有改动，记得在本地执行 npm run build 后上传 dist:"
echo "  cd frontend && npm run build"
echo "  scp -r frontend/dist/ root@47.109.157.191:/opt/pdf-reader/frontend/dist/"
