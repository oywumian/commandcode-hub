# Command Code Hub

面向个人自托管的 Command Code 网关和管理后台。它将 Command Code 转换为 OpenAI、Anthropic 和 Responses 兼容接口，并提供多账号、自动路由、额度监控、模型权限检测和请求日志。

## 当前功能

- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/responses`
- `GET /v1/models`
- 多个 Command Code 账号，支持启用、停用、删除和额度刷新
- 两种账号路由：固定默认账号、自动选择健康账号
- 自动路由按 5 小时和周额度使用率选择账号，并按模型权限过滤
- 多账号模型目录合并；同一个模型只要有一个账号可用就会出现在 `/v1/models`
- 多个网关 API Key，可独立创建、停用和删除
- 管理员密码可在后台修改，最低 6 位
- 每 5 分钟刷新账号额度，SQLite 保留额度历史
- 总览页汇总所有已启用账号的额度；账号页显示单账号额度
- 终端监控：请求、上游连接、首字延迟、SSE、工具调用、Token 和错误事件
- 模型库：短模型名、账号权限检测、Go 套餐参考价和今日 Token 额度估算
- 不保存提示词和回复正文，账号密钥使用 AES-256-GCM 加密

上游代理的协议细节见 [README_zh.md](README_zh.md)。

## 本地开发

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run build
npm test
npm start
```

开发环境默认地址：

- 管理后台：`http://127.0.0.1:3050/admin/`
- 网关：`http://127.0.0.1:3050/v1`
- 健康检查：`http://127.0.0.1:3050/health`
- 默认管理员密码：`admin`
- 默认网关 Key：`local-proxy`

开发默认值只用于本地测试，公网部署必须使用环境变量覆盖。

## Debian 部署

下面的步骤适合当前服务器：Debian、root、Nginx、服务目录 `/opt/commandcode-hub`，Hub 使用 `3052`，内部代理使用 `3053`。

### 1. 安装 Node.js 22 和依赖

如果服务器已经可以运行 `node -v`，确认版本不低于 22 后可以跳过 Node.js 安装。

```bash
apt update
apt install -y ca-certificates curl git nginx build-essential openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
```

### 2. 获取项目

首次安装：

```bash
git clone https://github.com/oywumian/commandcode-hub.git /opt/commandcode-hub
cd /opt/commandcode-hub
npm ci
npm run build
```

已有安装更新：

```bash
cd /opt/commandcode-hub
git pull --ff-only
npm ci
npm run build
```

### 3. 创建生产配置

```bash
cp deploy/commandcode-hub.env.example /etc/commandcode-hub.env
chmod 600 /etc/commandcode-hub.env
```

编辑 `/etc/commandcode-hub.env`，至少设置当前部署使用的端口和随机密钥：

```bash
sed -i \
  -e 's/^HUB_PORT=.*/HUB_PORT=3052/' \
  -e 's/^INTERNAL_PROXY_PORT=.*/INTERNAL_PROXY_PORT=3053/' \
  -e "s|replace-with-a-long-random-client-key|sk-$(openssl rand -hex 32)|" \
  -e "s|replace-with-a-strong-admin-password|$(openssl rand -hex 16)|" \
  -e "s|replace-with-a-long-random-encryption-key|$(openssl rand -hex 32)|" \
  -e "s|replace-with-a-different-random-session-key|$(openssl rand -hex 32)|" \
  /etc/commandcode-hub.env
```

查看初始管理员密码和网关 Key：

```bash
grep -E '^(ADMIN_PASSWORD|GATEWAY_API_KEY)=' /etc/commandcode-hub.env
```

重要事项：

- `MASTER_KEY` 丢失后无法解密数据库里的账号 Key，必须妥善备份。
- `ADMIN_PASSWORD` 是初始化密码，登录后台后可在“系统”页面修改。
- `GATEWAY_API_KEY` 首次启动会迁移为 Bootstrap Key，之后可在后台创建多个网关 Key。
- 账号认证文件默认读取 `/root/.commandcode/auth.json`。

### 4. 安装并启动 systemd

```bash
cp deploy/commandcode-hub.service /etc/systemd/system/commandcode-hub.service
systemctl daemon-reload
systemctl enable --now commandcode-hub
systemctl status commandcode-hub --no-pager
curl http://127.0.0.1:3052/health
```

实时日志：

```bash
journalctl -u commandcode-hub -f
```

正常情况下应看到 Hub 监听 `127.0.0.1:3052`、内部代理监听 `127.0.0.1:3053`，健康检查返回 `{"status":"ok"}`。

### 5. 配置 Nginx 和 HTTPS

先确认 80/443 没有被其他 Web 服务占用。把示例域名替换为自己的域名：

```bash
sed 's/hub\.example\.com/niuyeye.xyz/g' deploy/nginx-http.conf \
  > /etc/nginx/sites-available/commandcode-hub
ln -s /etc/nginx/sites-available/commandcode-hub \
  /etc/nginx/sites-enabled/commandcode-hub
nginx -t
systemctl reload nginx
```

申请 HTTPS：

```bash
certbot --nginx -d niuyeye.xyz
```

配置完成后：

- 管理后台：`https://niuyeye.xyz/admin/`
- OpenAI Base URL：`https://niuyeye.xyz/v1`
- 模型列表：`https://niuyeye.xyz/v1/models`

如果 80 端口仍被其他服务占用，先确认该服务是否需要保留；不要让多个服务同时监听同一个端口。

## 账号和自动路由

登录“账号”页面后，可以：

1. 从 `/root/.commandcode/auth.json` 导入账号。
2. 手动添加 `user_...` API Key。
3. 刷新每个账号的额度。
4. 在“模型库”中按账号检测模型权限。
5. 选择“固定默认账号”或“自动选择健康账号”。

固定默认账号模式下，所有请求都使用标记为“默认路由”的账号。

自动模式下，每个新请求会从已启用账号中选择：

- 优先选择 5 小时和周额度使用率更低的账号。
- 避开已经超限的账号。
- 根据请求模型的账号权限选择可用账号。
- `/v1/models` 合并所有已启用账号中可用的模型。

账号切换只影响新请求。已经开始的流式请求不会中途换账号，也不会在上游已经执行后盲目重试，避免重复执行工具调用或产生重复消耗。

## 模型库和价格

模型库显示上游模型的短名称，并按账号保存可用性检测结果。明确无权限的模型会停用，客户端访问 `/v1/models` 时不会看到停用模型。

“今日参考额度”按今天记录的输入、输出和缓存读 Token，以及 Go 套餐参考价估算。它不是 Command Code Studio 的真实账单，实际扣费以官方 Usage 页面为准。

## 网关客户端

OpenAI SDK：

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://niuyeye.xyz/v1",
    api_key="你的网关 API Key",
)

response = client.chat.completions.create(
    model="gpt-5.6-luna",
    messages=[{"role": "user", "content": "你好"}],
)
print(response.choices[0].message.content)
```

Anthropic SDK 使用同一个网关 Key 放在 `x-api-key` 中。模型名使用模型库显示的短名称。

## 更新和备份

更新：

```bash
cd /opt/commandcode-hub
git pull --ff-only
npm ci
npm run build
systemctl restart commandcode-hub
systemctl status commandcode-hub --no-pager
curl http://127.0.0.1:3052/health
```

备份：

```bash
systemctl stop commandcode-hub
tar czf /root/commandcode-hub-backup.tgz \
  /var/lib/commandcode-hub /etc/commandcode-hub.env
systemctl start commandcode-hub
```

恢复数据库时必须使用原来的 `MASTER_KEY`。代码更新异常时，可以先恢复上一版代码，再重启服务；数据库和环境文件不要删除。

## 常用排查

```bash
systemctl status commandcode-hub --no-pager -l
journalctl -u commandcode-hub -n 100 --no-pager
ss -lntp | grep -E ':(80|443|3052|3053) '
nginx -t
curl http://127.0.0.1:3052/health
curl -I https://你的域名/admin/
```

如果后台出现旧页面，执行浏览器强制刷新：`Ctrl + F5`。

## 验证

```bash
npm test
npm run build
git diff --check
curl -H "Authorization: Bearer 你的网关 API Key" \
  https://你的域名/v1/models
```
