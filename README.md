# 肥鱼模型社区

肥鱼（FeiyuAim）模型社区的前端、后端和宝塔部署配置。当前版本基线为 `1.0`。

## 目录

- `frontend/`：Vue + Vite 社区网页源码和可直接部署的 `dist/`
- `backend/`：Node.js/Express 多用户社区 API，包含上传、审核、评论、收藏、举报和下载
- `deploy/`：宝塔/Nginx 与 systemd 部署脚本
- `releases/`：发布说明；APK 二进制放在 GitHub Release，不提交到 Git 历史

## 本地开发

```powershell
cd frontend
pnpm install
pnpm dev
```

```powershell
cd backend
pnpm install
# 生产环境必须设置 JWT_SECRET、ADMIN_PASSWORD 和 CORS_ORIGINS
pnpm start
```

后端测试：

```powershell
cd backend
pnpm test
```

## 生产部署

使用 `deploy/install.sh`，并按 `backend/README.md` 配置独立运行用户、HTTPS、随机 JWT 密钥和管理员密码。不要将 `.env`、SQLite 数据库、上传模型或任何 API key 提交到公开仓库。

## APK 发布

APK 使用 GitHub Release 管理，发布时保留版本号、变更说明和 SHA-256。当前仓库只保存源代码和部署配置，避免超过 GitHub 普通 Git 文件大小限制。
