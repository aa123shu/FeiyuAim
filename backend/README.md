# 肥鱼模型社区服务器

这是肥鱼模型社区的本地服务器 MVP。它与当前卡密服务彼此独立，提供多用户注册登录、模型上传与审核、评论、收藏、举报、下载统计和真实文件下载。

## 本地启动

1. 安装 Node.js 22 或更高版本。
2. 参考 .env.example 设置 JWT 密钥和管理员密码。
3. 运行 pnpm install。
4. 运行 pnpm start。
5. 打开 http://127.0.0.1:8787/api/health 检查服务状态。

首次管理员由 ADMIN_USERNAME、ADMIN_PASSWORD 初始化。生产部署脚本会生成随机密码并写入权限受限的环境文件，只在首次安装的终端中显示；管理员仅在数据库首次创建时初始化，之后修改环境变量不会重置已有账号密码。

PowerShell 本地示例：

    $env:JWT_SECRET = '请替换为长随机字符串'
    $env:ADMIN_PASSWORD = '请替换管理员密码'
    pnpm start

## 测试

运行 pnpm test。

集成测试会自动创建临时 SQLite 数据库，并使用两个普通账号和一个管理员账号验证上传、待审核隐藏、管理员审核、跨账号浏览、收藏、评论、举报和真实文件下载。

## 部署前要求

- 设置强随机 JWT_SECRET 和新的管理员密码。
- 使用 Nginx 反向代理，并只公开 HTTPS 端口。
- 登录和注册接口启用了按来源 IP 的请求频率限制。
- 上传每个 IP 每小时最多 20 次；服务器可用空间低于 2GB 加本次文件大小时会拒收，避免耗尽系统盘。
- 生产环境必须显式设置 CORS_ORIGINS；网页填写实际 HTTPS 域名，APK WebView 按需额外加入 null。
- 社区服务使用独立 Linux 用户，不能使用 root 运行。
- 定期备份 data/community.sqlite 和 uploads/。
- 30GB 服务器建议把 MAX_UPLOAD_MB 设置为 100 或更低。
- 生产规模扩大后，将 SQLite 迁移到 PostgreSQL，并把模型文件迁移到 R2、S3 或 OSS。
