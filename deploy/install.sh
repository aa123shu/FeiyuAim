#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
ARCHIVE_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BACKEND_SOURCE="$ARCHIVE_ROOT/backend"
FRONTEND_SOURCE="$ARCHIVE_ROOT/frontend"
INSTALL_ROOT="/www/wwwroot/fatfish-community"
APP_ROOT="$INSTALL_ROOT/app"
RELEASES="$APP_ROOT/releases"
SITE_DIST="/www/wwwroot/kami/frontend/dist"
WEB_ROOT="$SITE_DIST/community"
SERVICE_NAME="fatfish-community"
SERVICE_FILE="/etc/systemd/system/fatfish-community.service"
ENV_FILE="$INSTALL_ROOT/.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 aaPanel 管理员终端以 root 执行此脚本。" >&2
  exit 1
fi
if [[ ! -f "$BACKEND_SOURCE/package.json" || ! -f "$BACKEND_SOURCE/src/server.js" ]]; then
  echo "部署包缺少 backend 源码，请确认已完整解压。" >&2
  exit 1
fi
if [[ ! -f "$FRONTEND_SOURCE/index.html" || ! -d "$FRONTEND_SOURCE/assets" ]]; then
  echo "部署包缺少 frontend 构建文件，请确认已完整解压。" >&2
  exit 1
fi
if [[ ! -d "$SITE_DIST" ]]; then
  echo "未找到现有卡密前端目录：$SITE_DIST；为避免误写，请先确认 aaPanel 站点根目录。" >&2
  exit 1
fi
if [[ ! -f "/www/server/panel/vhost/nginx/kami-ip.conf" ]]; then
  echo "未找到 kami-ip.conf；请核对站点配置文件路径后再部署。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! node -e "if(Number(process.versions.node.split('.')[0]) < 22) process.exit(1); import('node:sqlite')" >/dev/null 2>&1; then
  echo "安装 Node.js 22 LTS..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  printf '%s\n' "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

node -e "import('node:sqlite').then(() => console.log('Node.js ' + process.versions.node + ' / SQLite OK'))"
NODE_BIN="$(command -v node)"
if ! getent passwd fatfish-community >/dev/null; then
  useradd --system --home-dir "$INSTALL_ROOT" --no-create-home --shell /usr/sbin/nologin fatfish-community
fi

install -d -o fatfish-community -g fatfish-community -m 0750 "$INSTALL_ROOT" "$INSTALL_ROOT/data" "$INSTALL_ROOT/uploads" "$RELEASES"

if [[ ! -f "$ENV_FILE" ]]; then
  JWT_SECRET="$(openssl rand -hex 48)"
  ADMIN_PASSWORD="$(openssl rand -hex 16)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DB_PATH=$INSTALL_ROOT/data/community.sqlite
UPLOAD_DIR=$INSTALL_ROOT/uploads
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=30d
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_NICKNAME=社区管理员
MAX_UPLOAD_MB=100
MIN_FREE_MB=2048
CORS_ORIGINS=http://45.207.193.245,https://45.207.193.245,null
EOF
  chown root:fatfish-community "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  echo "首次管理员账号：admin"
  echo "首次管理员密码（请立即保存，只显示这一次）：$ADMIN_PASSWORD"
else
  echo "检测到已有社区环境文件，保留原密钥和管理员密码。"
fi

RELEASE_ID="$(date +%Y%m%d%H%M%S)"
RELEASE="$RELEASES/$RELEASE_ID"
install -d -o fatfish-community -g fatfish-community -m 0750 "$RELEASE"
cp -a "$BACKEND_SOURCE/." "$RELEASE/"
chown -R fatfish-community:fatfish-community "$RELEASE"
runuser -u fatfish-community -- npm --prefix "$RELEASE" install --omit=dev --no-audit --no-fund

if [[ -e "$APP_ROOT/current" && ! -L "$APP_ROOT/current" ]]; then
  echo "$APP_ROOT/current 已存在且不是符号链接；停止以保护现有文件。" >&2
  exit 1
fi
ln -sfn "$RELEASE" "$APP_ROOT/current"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=FatFish Model Community API
After=network.target

[Service]
Type=simple
User=fatfish-community
Group=fatfish-community
WorkingDirectory=$APP_ROOT/current
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $APP_ROOT/current/src/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=$INSTALL_ROOT/data $INSTALL_ROOT/uploads

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$SERVICE_FILE"

STAGING="$SITE_DIST/.community-stage-$RELEASE_ID"
BACKUP="$SITE_DIST/community.backup-$RELEASE_ID"
install -d -m 0755 "$STAGING"
cp -a "$FRONTEND_SOURCE/." "$STAGING/"
if [[ -e "$WEB_ROOT" ]]; then
  mv "$WEB_ROOT" "$BACKUP"
  echo "已备份旧社区静态目录：$BACKUP"
fi
mv "$STAGING" "$WEB_ROOT"
chmod -R a+rX "$WEB_ROOT"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2
  exit 1
fi
if ! curl --fail --silent http://127.0.0.1:8787/api/health; then
  journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2
  exit 1
fi

echo
echo "后端已安装并只监听 127.0.0.1:8787。"
echo "前端已安装到 $WEB_ROOT。"
echo "下一步：把部署包 deploy/nginx-community.conf 中的 location 片段加入 kami-ip.conf 的 server { } 内，保留原 /api/ 配置，然后执行 nginx -t && systemctl reload nginx。"
echo "卡密后端、卡密数据库、原 /api/ 路由和原前端文件均未被本脚本修改。"
