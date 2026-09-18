# Command Code Hub

面向个人自托管的 Command Code 网关。它保留上游 `commandcode-proxy` 的 OpenAI、Anthropic 和 Responses 协议转换能力，并增加多账号、统一 API Key、真实额度、请求统计和网页管理。

## 功能

- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/responses`
- `GET /v1/models`
- 多个可命名、可启停和删除的网关 API Key
- 多个 Command Code 账号和手动默认账号切换
- 从 `/root/.commandcode/auth.json` 导入当前 CLI 登录账号
- 每 5 分钟刷新真实额度，保留 90 天趋势
- 请求状态、模型、Token 和耗时统计，保留 7 天
- 终端监控：请求接入、上游连接、首字延迟、SSE 流式、工具调用、Token 用量和错误事件
- 模型库：按账号隔离读取上游 `/v1/models`，对外隐藏品牌前缀，支持搜索和复制短模型 ID
- 模型库支持逐账号可用性检测；明确无权限的模型会停用，终端 `/v1/models` 只返回该账号已启用模型
- API 使用短模型名；服务端按账号维护“短名称 → 上游模型 ID”别名映射
- 不保存提示词和回复正文
- SQLite 本地存储，账号密钥使用 AES-256-GCM 加密

上游代理的详细协议说明保留在 [README_zh.md](README_zh.md)。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm install
npm run build
npm start
```

开发模式默认值：

- 管理地址：`http://127.0.0.1:3050/admin/`
- 管理密码：`admin`
- 网关 API Key：`local-proxy`
- 数据目录：`./data`

## Debian 部署

以下示例使用 `/opt/commandcode-hub`，以 root 运行。部署新服务时先不要停止旧的 `cmdc-hub`，可以临时把 `HUB_PORT` 改成 `3052` 完成并行验证。

### 1. 安装项目

```bash
apt update
apt install -y git nginx certbot python3-certbot-nginx build-essential
git clone https://github.com/YOUR_NAME/commandcode-hub.git /opt/commandcode-hub
cd /opt/commandcode-hub
npm ci
npm run build
install -d -m 700 /var/lib/commandcode-hub
```

如果代码不是放在 GitHub，将当前项目目录上传到 `/opt/commandcode-hub` 后执行后三条命令即可。

### 2. 配置密钥

```bash
cp deploy/commandcode-hub.env.example /etc/commandcode-hub.env
chmod 600 /etc/commandcode-hub.env
openssl rand -hex 32
```

分别生成随机值并编辑 `/etc/commandcode-hub.env`：

- `GATEWAY_API_KEY`：首次启动自动迁移为名为 `Bootstrap key` 的网关 API Key。后续新增、停用、删除和轮换 Key 都在网页控制台的“系统”页面完成
- `ADMIN_PASSWORD`：初始化管理员密码。首次登录后可在“系统”页面修改，数据库保存盐值加密哈希；修改后所有旧登录会话立即失效
- `MASTER_KEY`：加密数据库中的 Command Code 密钥，丢失后无法解密
- `SESSION_SECRET`：签名管理会话

`MASTER_KEY` 上线后不要更换。更换前必须先删除并重新导入所有账号。

### 3. 启动 systemd

```bash
cp deploy/commandcode-hub.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now commandcode-hub
systemctl status commandcode-hub
curl http://127.0.0.1:3050/health
```

实时日志：

```bash
journalctl -u commandcode-hub -f
```

### 4. nginx 和证书

先把 `hub.example.com` 全部替换为你的域名，然后启用无证书配置：

```bash
sed 's/hub\.example\.com/你的域名/g' deploy/nginx-http.conf > /etc/nginx/sites-available/commandcode-hub
ln -s /etc/nginx/sites-available/commandcode-hub /etc/nginx/sites-enabled/commandcode-hub
nginx -t && systemctl reload nginx
certbot --nginx -d 你的域名
```

Certbot 成功后会直接生成可用的 HTTPS 配置。也可以把 `deploy/nginx.conf` 中的示例域名替换后作为最终配置，再执行：

```bash
nginx -t && systemctl reload nginx
```

管理页面：`https://你的域名/admin/`

OpenAI Base URL：`https://你的域名/v1`

### 5. 添加账号

登录管理页面后可以：

1. 点击“从本机认证文件导入”，读取 `/root/.commandcode/auth.json`。
2. 点击“添加账号”，手动输入 `user_...` API Key。
3. 在账号列表中选择默认账号。

切换只影响新请求，已经开始的流式请求会继续使用原账号。当前版本不会自动故障转移；账号不可用时会明确返回错误，需在控制台手动切换。

### 6. 检测账号可用模型

在“模型库”选择账号后点击“检测可用性”。服务端会逐个发送一次最小请求：明确无权限的模型标记为“不可用”并停用，模型校验类错误保留为“可用”，临时超时或上游故障标记为“待确认”且不会误停用。

检测结果按账号写入 SQLite，刷新页面或重启服务后会保留。客户端通过 `/v1/models` 只能看到当前默认账号已启用的模型；调用被停用的模型会直接返回 `model_not_available`。

### 7. 管理密码和网关 Key

网页控制台的“系统”页面支持：

1. 免确认创建多个命名的网关 API Key，为不同客户端分配独立凭证。
2. 免确认停用、启用和删除单个 Key；至少保留一个启用 Key。
3. 修改管理员密码，最低 6 位；新密码只保存加盐哈希。

网关 Key 只显示一次完整值，数据库只保存 SHA-256 哈希和脱敏预览。客户端改用新 Key 后，可立即停用旧 Key。

## 客户端配置

OpenAI SDK 示例：

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://你的域名/v1",
    api_key="你设置的 GATEWAY_API_KEY",
)

response = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=[{"role": "user", "content": "你好"}],
)
print(response.choices[0].message.content)
```

Anthropic SDK 可把同一个全局密钥放在 `x-api-key` 中。

## 备份与恢复

先停止服务，再备份 SQLite 数据和环境文件：

```bash
systemctl stop commandcode-hub
tar czf /root/commandcode-hub-backup.tgz /var/lib/commandcode-hub /etc/commandcode-hub.env
systemctl start commandcode-hub
```

恢复时必须同时恢复原来的 `MASTER_KEY`，否则数据库中的账号密钥无法解密。

## 更新

```bash
cd /opt/commandcode-hub
git pull --ff-only
npm ci
npm run build
systemctl restart commandcode-hub
curl http://127.0.0.1:3050/health
```

`proxy.mjs` 与 `model-catalog.mjs` 保持为独立上游核心，更新上游时优先替换这两个文件并运行测试，避免管理层与协议转换代码发生合并冲突。

## 回滚

在切换 nginx 前保留旧服务。新服务异常时，将 nginx 的 `proxy_pass` 改回旧服务端口并重新加载即可。数据库文件位于 `/var/lib/commandcode-hub/hub.sqlite`，回滚代码前先备份该目录。

## 验证

```bash
npm test
npm run build
curl -H "Authorization: Bearer 你的全局网关密钥" https://你的域名/v1/models
```
