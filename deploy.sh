#!/bin/bash
# ============================================================
# PDF 外刊阅读工具 — 阿里云 ECS 一键部署脚本
# 适配: Alibaba Cloud Linux (CentOS/RHEL based, yum)
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${CYAN}>>> $1${NC}"; }

# ============================================================
# Step 0: Pre-flight checks
# ============================================================
log_step "Step 0: Pre-flight checks"

if [ "$(id -u)" != "0" ]; then
    log_error "请以 root 用户运行此脚本: sudo bash deploy.sh"
    exit 1
fi

# Ensure we're in the project directory
if [ ! -f "docker-compose.yml" ]; then
    log_error "请在项目根目录下运行此脚本 (docker-compose.yml 所在目录)"
    exit 1
fi

log_info "系统信息: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
log_info "CPU 核心数: $(nproc)"
log_info "内存: $(free -h | awk '/^Mem:/{print $2}')"

# ============================================================
# Step 1: Install Docker
# ============================================================
log_step "Step 1: 安装 Docker"

if command -v docker &> /dev/null; then
    log_info "Docker 已安装: $(docker --version)"
else
    log_info "正在安装 Docker CE..."

    # Remove old versions if any
    yum remove -y docker docker-client docker-client-latest docker-common \
        docker-latest docker-latest-logrotate docker-logrotate docker-engine \
        &>/dev/null || true

    # Install yum-utils for yum-config-manager
    yum install -y yum-utils

    # Add Docker CE repo (Alibaba Cloud Linux 使用 CentOS 源)
    yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

    # Install Docker CE + Docker Compose plugin
    yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    log_info "Docker 安装完成: $(docker --version)"
fi

# ============================================================
# Step 2: Start Docker daemon
# ============================================================
log_step "Step 2: 启动 Docker 服务"

systemctl enable docker
if ! systemctl is-active --quiet docker; then
    systemctl start docker
fi
log_info "Docker 状态: $(systemctl is-active docker)"

# Verify docker compose (plugin)
if ! docker compose version &> /dev/null; then
    log_error "docker compose 插件不可用，请检查 Docker 安装"
    exit 1
fi
log_info "Docker Compose: $(docker compose version)"

# ============================================================
# Step 3: Configure .env
# ============================================================
log_step "Step 3: 配置环境变量 (.env)"

if [ -f ".env" ]; then
    log_warn ".env 文件已存在，跳过配置"
    echo "  如需重新配置，请删除 .env 后重新运行此脚本"
else
    echo ""
    echo "  ┌─────────────────────────────────────────────┐"
    echo "  │  请输入以下 API 密钥（按 Enter 跳过可稍后配置）  │"
    echo "  └─────────────────────────────────────────────┘"
    echo ""

    # Copy template
    cp .env.example .env

    # Generate a random SECRET_KEY
    RANDOM_KEY=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 64)
    sed -i "s/^SECRET_KEY=.*/SECRET_KEY=${RANDOM_KEY}/" .env

    # DeepSeek API Key
    read -p "  DeepSeek API Key (必填): " DEEPSEEK_KEY
    if [ -n "$DEEPSEEK_KEY" ]; then
        sed -i "s/^DEEPSEEK_API_KEY=.*/DEEPSEEK_API_KEY=${DEEPSEEK_KEY}/" .env
    fi

    # MinerU Token
    read -p "  MinerU API Token (PDF 解析，必填): " MINERU_TOKEN
    if [ -n "$MINERU_TOKEN" ]; then
        sed -i "s/^MINERU_API_TOKEN=.*/MINERU_API_TOKEN=${MINERU_TOKEN}/" .env
    fi

    # DB Password
    read -p "  数据库密码 (默认 pdfreader_pass): " DB_PW
    if [ -n "$DB_PW" ]; then
        sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=${DB_PW}/" .env
    fi

    echo ""
    log_info ".env 配置完成"
fi

# ============================================================
# Step 4: Open firewall port (if firewalld is running)
# ============================================================
log_step "Step 4: 配置防火墙"

if systemctl is-active --quiet firewalld; then
    if ! firewall-cmd --list-ports | grep -q "80/tcp"; then
        firewall-cmd --permanent --add-port=80/tcp
        firewall-cmd --reload
        log_info "防火墙已开放 80 端口"
    else
        log_info "80 端口已开放，跳过"
    fi
else
    log_info "firewalld 未运行，跳过防火墙配置"
fi

# 重要提醒：阿里云安全组
echo ""
log_warn "⚠ 重要: 请确保阿里云 ECS 安全组已开放 80 端口!"
echo "  操作路径: 阿里云控制台 → ECS → 安全组 → 入方向 → 添加规则"
echo "  端口: 80/80, 来源: 0.0.0.0/0"
echo ""

# ============================================================
# Step 5: Build & Start containers
# ============================================================
log_step "Step 5: 构建并启动容器"

log_info "正在拉取基础镜像并构建应用镜像..."
docker compose build --pull

log_info "正在启动所有服务..."
docker compose up -d

# ============================================================
# Step 6: Wait for healthy
# ============================================================
log_step "Step 6: 等待服务就绪"

MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    STATUS=$(docker compose ps --format json 2>/dev/null | grep -v '"Health":"healthy"' | grep -v '"Health":""' | wc -l || echo "0")

    if [ "$STATUS" -eq 0 ]; then
        # Double-check with health endpoint
        if curl -sf http://localhost/health > /dev/null 2>&1; then
            log_info "所有服务已就绪! (耗时 ${WAITED}s)"
            break
        fi
    fi

    sleep 3
    WAITED=$((WAITED + 3))
    echo -n "."
done

if [ $WAITED -ge $MAX_WAIT ]; then
    log_warn "部分服务可能尚未就绪，请检查日志"
    echo ""
    echo "  查看状态: docker compose ps"
    echo "  查看日志: docker compose logs -f"
fi

# ============================================================
# Step 7: Print summary
# ============================================================
ECS_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ip.sb 2>/dev/null || echo "YOUR_ECS_IP")

echo ""
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║         🎉  部署完成！                          ║"
echo "  ╠═══════════════════════════════════════════════╣"
echo "  ║                                               ║"
echo "  ║  前端页面:  http://${ECS_IP}                "
echo "  ║  API 文档:   http://${ECS_IP}/docs            "
echo "  ║  健康检查:   http://${ECS_IP}/health          "
echo "  ║                                               ║"
echo "  ╠═══════════════════════════════════════════════╣"
echo "  ║  常用命令:                                     ║"
echo "  ║  docker compose ps          查看服务状态        ║"
echo "  ║  docker compose logs -f     查看实时日志        ║"
echo "  ║  docker compose restart     重启所有服务        ║"
echo "  ║  docker compose down        停止所有服务        ║"
echo "  ║  docker compose up -d       启动所有服务        ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo ""
log_info "部署脚本执行完毕"
