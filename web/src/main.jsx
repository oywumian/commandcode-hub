import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Check, ChevronRight, CircleDollarSign, Clock3, Copy, Gauge, KeyRound,
  LayoutDashboard, LockKeyhole, LogOut, Menu, Plus, RefreshCw, Server,
  Settings2, ShieldCheck, Trash2, UsersRound, X,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts';
import './styles.css';

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const dateTime = (value) => value ? new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(value)) : '不可用';
const whole = (value) => Number(value || 0).toLocaleString('zh-CN');
const duration = (value) => value >= 1000 ? `${(value / 1000).toFixed(1)} 秒` : `${Math.round(value || 0)} 毫秒`;
const percent = (used, cap) => cap > 0 && used !== null ? Math.min(100, Math.max(0, used / cap * 100)) : null;

function Button({ icon: Icon, children, kind = 'secondary', busy, ...props }) {
  return <button className={`button ${kind}`} disabled={busy || props.disabled} {...props}>
    {busy ? <RefreshCw size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
    {children}
  </button>;
}

function Empty({ children }) {
  return <div className="empty"><Server size={28} />{children}</div>;
}

function QuotaMeter({ label, value, cap, remaining, resetAt, estimated }) {
  const used = value ?? (cap !== null && remaining !== null ? Math.max(0, cap - remaining) : null);
  const ratio = percent(used, cap);
  return <article className="quota-meter">
    <div className="quota-heading">
      <span>{label}{estimated ? <small>估算</small> : null}</span>
      <strong>{used === null || cap === null ? '不可用' : `${used.toFixed(2)} / ${cap.toFixed(2)}`}</strong>
    </div>
    <div className="meter"><i style={{ width: `${ratio ?? 0}%` }} /></div>
    <div className="quota-foot">
      <span>{ratio === null ? '无百分比' : `${ratio.toFixed(1)}%`}</span>
      <span>{resetAt ? `重置 ${dateTime(resetAt)}` : '无重置时间'}</span>
    </div>
  </article>;
}

function AccountQuotaMeter({ label, used, cap, resetAt, estimated }) {
  const ratio = percent(used, cap);
  const remaining = ratio === null ? null : 100 - ratio;
  const tone = remaining === null ? '' : remaining >= 50 ? 'ok' : remaining >= 20 ? 'warn' : 'danger';
  return <div className="account-meter">
    <div className="account-meter-head">
      <span>{label}{estimated ? <small>估算</small> : null}</span>
      <strong className={tone}>{remaining === null ? '不可用' : `剩余 ${remaining.toFixed(1)}%`}</strong>
    </div>
    <div className="account-meter-track"><i className={tone} style={{ width: `${remaining ?? 0}%` }} /></div>
    <div className="account-meter-foot">
      <span>{used === null || cap === null ? '额度不可用' : `已用 ${used.toFixed(2)} / ${cap.toFixed(2)}`}</span>
      <span>{resetAt ? `重置 ${dateTime(resetAt)}` : '暂无重置点'}</span>
    </div>
  </div>;
}

function Stat({ icon: Icon, label, value, detail }) {
  return <article className="stat">
    <div className="stat-icon"><Icon size={18} /></div>
    <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
  </article>;
}

function Login({ onLogin, notice }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return <main className="login-shell">
    <form className="login-panel" onSubmit={submit}>
      <div className="brand-mark"><CommandMark /></div>
      <p className="eyebrow">COMMAND CODE HUB</p>
      <h1>管理控制台</h1>
      {notice ? <div className="notice success">{notice}</div> : null}
      <label>管理员密码<input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error ? <div className="form-error">{error}</div> : null}
      <Button kind="primary" icon={KeyRound} busy={busy} type="submit">登录</Button>
    </form>
  </main>;
}

function CommandMark() {
  return <span className="command-mark"><i /><i /><i /></span>;
}

function Overview({ data, reload, busy }) {
  const account = data?.defaultAccount;
  const quota = account?.quota;
  const summary = data?.requestSummary || {};
  const success = summary.total ? summary.successful / summary.total * 100 : 0;
  const quotaChart = (data?.quotaHistory || []).map((row) => ({
    time: dateTime(row.captured_at),
    fiveHour: row.five_used,
    weekly: row.weekly_used,
    monthlyRemaining: row.monthly_remaining,
  }));
  const requestChart = (data?.requestSeries || []).map((row) => ({
    time: new Date(row.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    requests: row.total,
    tokens: row.input_tokens + row.output_tokens,
  }));
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">实时状态</p><h1>总览</h1></div>
      <Button icon={RefreshCw} busy={busy} onClick={reload}>刷新</Button>
    </div>
    <section className="stats-grid">
      <Stat icon={UsersRound} label="账号" value={data?.accounts?.length || 0} detail={account ? `当前：${account.name}` : '未选择默认账号'} />
      <Stat icon={Activity} label="24 小时请求" value={whole(summary.total)} detail={`成功率 ${success.toFixed(1)}%`} />
      <Stat icon={Gauge} label="平均耗时" value={duration(summary.avg_duration_ms)} detail="最近 24 小时" />
      <Stat icon={CircleDollarSign} label="Token" value={whole((summary.input_tokens || 0) + (summary.output_tokens || 0))} detail={`缓存 ${whole(summary.cached_tokens)}`} />
    </section>
    {!account ? <Empty>请先在“账号”中添加并选择默认账号。</Empty> : <>
      <section className="section-block">
        <div className="section-title"><div><h2>{account.name}</h2><p>{account.planName || '套餐不可用'} · 更新于 {dateTime(account.lastQuotaAt)}</p></div><span className="status-dot">默认账号</span></div>
        <div className="quota-grid">
          <QuotaMeter label="5 小时额度" value={quota?.credits?.fiveHour?.used ?? null} cap={quota?.credits?.fiveHour?.cap ?? null} resetAt={quota?.credits?.fiveHour?.resetAt} />
          <QuotaMeter label="每周额度" value={quota?.credits?.weekly?.used ?? null} cap={quota?.credits?.weekly?.cap ?? null} resetAt={quota?.credits?.weekly?.resetAt} />
          <QuotaMeter label="每月额度" value={quota?.monthly?.used ?? null} cap={quota?.monthly?.cap ?? null} remaining={quota?.monthly?.remaining ?? null} resetAt={quota?.monthly?.resetAt} estimated={quota?.monthly?.estimated} />
        </div>
        <div className="credit-strip">
          <span>月度余额 <strong>{quota?.credits?.monthlyCredits ?? '不可用'}</strong></span>
          <span>购买额度 <strong>{quota?.credits?.purchasedCredits ?? '不可用'}</strong></span>
          <span>免费额度 <strong>{quota?.credits?.freeCredits ?? '不可用'}</strong></span>
        </div>
      </section>
      {account.lastError ? <div className="notice error">{account.lastError}</div> : null}
    </>}
    <section className="chart-grid">
      <div className="chart-panel">
        <div className="section-title"><div><h2>额度趋势</h2><p>最近 30 天</p></div></div>
        {quotaChart.length ? <ResponsiveContainer width="100%" height={260}>
          <LineChart data={quotaChart}><CartesianGrid stroke="rgba(0, 0, 0, .06)" vertical={false} /><XAxis dataKey="time" minTickGap={36} /><YAxis /><Tooltip /><Line type="monotone" dataKey="fiveHour" name="5 小时" stroke="#0071e3" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="weekly" name="每周" stroke="#86868b" dot={false} strokeWidth={2} /></LineChart>
        </ResponsiveContainer> : <Empty>还没有额度快照。</Empty>}
      </div>
      <div className="chart-panel">
        <div className="section-title"><div><h2>请求趋势</h2><p>最近 24 小时</p></div></div>
        {requestChart.length ? <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={requestChart}><CartesianGrid stroke="rgba(0, 0, 0, .06)" vertical={false} /><XAxis dataKey="time" minTickGap={36} /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="requests" name="请求" stroke="#0071e3" fill="rgba(0, 113, 227, .12)" strokeWidth={2} /></AreaChart>
        </ResponsiveContainer> : <Empty>还没有请求记录。</Empty>}
      </div>
    </section>
  </>;
}

function AccountDialog({ open, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return null;
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ name, apiKey }) });
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button close" type="button" onClick={onClose} title="关闭"><X size={18} /></button>
      <p className="eyebrow">新账号</p><h2>添加 Command Code 账号</h2>
      <label>名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="可留空自动识别" /></label>
      <label>API Key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="user_..." required /></label>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="modal-actions"><Button type="button" onClick={onClose}>取消</Button><Button kind="primary" icon={Plus} busy={busy} type="submit">添加</Button></div>
    </form>
  </div>;
}

function Accounts({ notify }) {
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState(false);
  const load = useCallback(async () => setAccounts((await api('/api/admin/accounts')).accounts), []);
  useEffect(() => { load(); }, [load]);
  async function action(key, fn, message) {
    setBusy(key);
    try { await fn(); await load(); notify(message); } catch (error) { notify(error.message, true); } finally { setBusy(''); }
  }
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">身份与路由</p><h1>账号</h1></div>
      <div className="actions"><Button icon={RefreshCw} busy={busy === 'all'} onClick={() => action('all', () => api('/api/admin/quotas/refresh', { method: 'POST' }), '全部额度已刷新')}>刷新全部</Button><Button kind="primary" icon={Plus} onClick={() => setDialog(true)}>添加账号</Button></div>
    </div>
    <div className="toolbar-line">
      <Button icon={KeyRound} busy={busy === 'import'} onClick={() => action('import', () => api('/api/admin/accounts/import', { method: 'POST' }), '认证文件已导入')}>从本机认证文件导入</Button>
      <span>{accounts.length} 个账号</span>
    </div>
    {accounts.length ? <div className="account-grid">
      {accounts.map((account) => {
        const credits = account.quota?.credits;
        const monthly = account.quota?.monthly;
        const status = account.lastError ? { label: '异常', className: 'error' } : account.quota ? { label: '正常', className: 'ok' } : { label: '未获取', className: 'muted' };
        return <article key={account.id} className={`account-card ${account.enabled ? '' : 'off'}`}>
          <header className="account-card-head">
            <div><strong title={account.name}>{account.name}</strong><code>{account.maskedKey}</code></div>
            <span className={`status-pill ${status.className}`}>{status.label}</span>
          </header>
          <div className="account-tags">
            <span className="plan-pill">{account.planName || '套餐不可用'}</span>
            <span className={`status-pill ${account.isDefault ? 'default' : 'muted'}`}>{account.isDefault ? '默认路由' : '备用'}</span>
            <span className={`status-pill ${account.enabled ? 'ok' : 'muted'}`}>{account.enabled ? '已启用' : '已停用'}</span>
          </div>
          <div className="account-credits">
            <span>月度余额<strong>{credits?.monthlyCredits ?? '不可用'}</strong></span>
            <span>购买额度<strong>{credits?.purchasedCredits ?? '不可用'}</strong></span>
            <span>免费额度<strong>{credits?.freeCredits ?? '不可用'}</strong></span>
          </div>
          <div className="account-meters">
            <AccountQuotaMeter label="5 小时滚动" used={credits?.fiveHour?.used ?? null} cap={credits?.fiveHour?.cap ?? null} resetAt={credits?.fiveHour?.resetAt} />
            <AccountQuotaMeter label="周额度" used={credits?.weekly?.used ?? null} cap={credits?.weekly?.cap ?? null} resetAt={credits?.weekly?.resetAt} />
            <AccountQuotaMeter label="月额度" used={monthly?.used ?? null} cap={monthly?.cap ?? null} resetAt={monthly?.resetAt} estimated={monthly?.estimated} />
          </div>
          {account.lastError ? <p className="account-error" title={account.lastError}>{account.lastError}</p> : null}
          <div className="account-card-foot">
            <span>更新 {dateTime(account.lastQuotaAt)}</span>
            <label className="switch" title={account.enabled ? '停用账号' : '启用账号'}>
              <input type="checkbox" checked={account.enabled} onChange={(e) => action(`enable-${account.id}`, () => api(`/api/admin/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ enabled: e.target.checked }) }), '账号状态已更新')} />
              <i />
            </label>
          </div>
          <div className="row-actions account-actions">
            {!account.isDefault ? <button className="icon-button" title="设为默认" onClick={() => action(`default-${account.id}`, () => api(`/api/admin/accounts/${account.id}/default`, { method: 'POST' }), '默认账号已切换')}><Check size={17} /></button> : null}
            <button className="icon-button" title="刷新额度" onClick={() => action(`refresh-${account.id}`, () => api(`/api/admin/accounts/${account.id}/refresh`, { method: 'POST' }), '额度已刷新')}><RefreshCw className={busy === `refresh-${account.id}` ? 'spin' : ''} size={17} /></button>
            <button className="icon-button danger" title="删除" onClick={() => confirm(`删除账号“${account.name}”？`) && action(`delete-${account.id}`, () => api(`/api/admin/accounts/${account.id}`, { method: 'DELETE' }), '账号已删除')}><Trash2 size={17} /></button>
          </div>
        </article>;
      })}
    </div> : <Empty>还没有账号。</Empty>}
    <AccountDialog open={dialog} onClose={() => setDialog(false)} onSaved={() => { setDialog(false); load(); notify('账号已添加'); }} />
  </>;
}

function Requests() {
  const [days, setDays] = useState(1);
  const [data, setData] = useState(null);
  const load = useCallback(() => api(`/api/admin/requests?days=${days}`).then(setData), [days]);
  useEffect(() => { load(); }, [load]);
  const summary = data?.summary || {};
  const success = summary.total ? summary.successful / summary.total * 100 : 0;
  return <>
    <div className="page-heading"><div><p className="eyebrow">流量审计</p><h1>请求</h1></div><div className="segmented">{[[1, '24 小时'], [3, '3 天'], [7, '7 天']].map(([value, label]) => <button className={days === value ? 'active' : ''} onClick={() => setDays(value)} key={value}>{label}</button>)}</div></div>
    <section className="stats-grid compact">
      <Stat icon={Activity} label="请求" value={whole(summary.total)} detail={`成功率 ${success.toFixed(1)}%`} />
      <Stat icon={Clock3} label="平均耗时" value={duration(summary.avg_duration_ms)} detail="端到端" />
      <Stat icon={ChevronRight} label="输入 Token" value={whole(summary.input_tokens)} detail={`缓存 ${whole(summary.cached_tokens)}`} />
      <Stat icon={ChevronRight} label="输出 Token" value={whole(summary.output_tokens)} detail="模型输出" />
    </section>
    <div className="table-wrap"><table><thead><tr><th>时间</th><th>账号</th><th>接口</th><th>模型</th><th>状态</th><th>Token</th><th>耗时</th></tr></thead><tbody>
      {(data?.requests || []).map((row) => <tr key={row.id}><td>{dateTime(row.created_at)}</td><td>{row.account_name || '已删除'}</td><td><code>{row.path}</code>{row.streaming ? <span className="tag subtle">流式</span> : null}</td><td>{row.model || '未知'}</td><td><span className={row.status >= 200 && row.status < 400 ? 'good' : 'bad'}>{row.status}</span></td><td>{whole(row.input_tokens + row.output_tokens)}</td><td>{duration(row.duration_ms)}</td></tr>)}
    </tbody></table>{!data?.requests?.length ? <Empty>所选时间内没有请求。</Empty> : null}</div>
  </>;
}

function ApiKeyResult({ apiKey, onClose, notify }) {
  if (!apiKey) return null;
  async function copyKey() {
    await navigator.clipboard.writeText(apiKey);
    notify('API Key 已复制');
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button close" type="button" onClick={onClose} title="关闭"><X size={18} /></button>
      <p className="eyebrow">仅显示一次</p><h2>新的网关 API Key</h2>
      <p className="modal-copy">旧 Key 已立即失效。请现在保存这个新 Key，关闭窗口后后台只显示掩码。</p>
      <div className="secret-output"><code>{apiKey}</code><button className="icon-button" onClick={copyKey} title="复制 API Key"><Copy size={17} /></button></div>
      <div className="modal-actions"><Button kind="primary" onClick={onClose}>我已保存</Button></div>
    </section>
  </div>;
}

function SystemPage({ notify, onPasswordChanged }) {
  const [runtime, setRuntime] = useState(null);
  const [security, setSecurity] = useState(null);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [keyForm, setKeyForm] = useState({ name: '' });
  const [generatedKey, setGeneratedKey] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [runtimeData, securityData] = await Promise.all([api('/api/admin/runtime'), api('/api/admin/security')]);
    setRuntime(runtimeData);
    setSecurity(securityData);
  }, []);
  useEffect(() => { load(); }, [load]);
  const rows = runtime ? [
    ['服务状态', runtime.status === 'ok' ? '正常' : runtime.status],
    ['运行时间', `${whole(runtime.uptimeSeconds)} 秒`],
    ['Node.js', runtime.nodeVersion],
    ['平台', runtime.platform],
    ['网关监听', runtime.gateway],
    ['内部代理', runtime.internalProxy],
    ['额度刷新', `${Math.round(runtime.quotaRefreshMs / 60000)} 分钟`],
    ['启动时间', dateTime(runtime.startedAt)],
  ] : [];
  async function changePassword(event) {
    event.preventDefault();
    setError('');
    if (passwords.newPassword !== passwords.confirmPassword) return setError('两次输入的新密码不一致');
    setBusy('password');
    try {
      await api('/api/admin/security/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword }),
      });
      onPasswordChanged();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function createKey(event) {
    event.preventDefault();
    setError('');
    setBusy('key');
    try {
      const result = await api('/api/admin/security/api-keys', { method: 'POST', body: JSON.stringify(keyForm) });
      setGeneratedKey(result.apiKey);
      setKeyForm({ name: '' });
      await load();
      notify('API Key 已创建');
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function updateKey(id, changes, message) {
    setError('');
    setBusy(id);
    try {
      await api(`/api/admin/security/api-keys/${id}`, { method: 'PUT', body: JSON.stringify(changes) });
      await load();
      notify(message);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function deleteKey(id) {
    setError('');
    setBusy(id);
    try {
      await api(`/api/admin/security/api-keys/${id}`, { method: 'DELETE' });
      await load();
      notify('API Key 已删除');
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">运行环境与安全</p><h1>系统</h1></div></div>
    <section className="settings-section">
      <div className="section-title"><div><h2>运行状态</h2><p>当前进程和内部代理</p></div><ShieldCheck size={19} /></div>
      <div className="system-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    </section>
    <section className="settings-section">
      <div className="section-title"><div><h2>网关 API Keys</h2><p>为不同客户端创建独立密钥，可单独停用和删除</p></div><KeyRound size={19} /></div>
      <div className="key-list">
        {(security?.apiKeys || []).map((key) => <div className="key-row" key={key.id}>
          <div className="key-identity"><strong>{key.name}</strong><code>{key.maskedKey}</code></div>
          <div className="key-meta"><span>最近使用 {dateTime(key.lastUsedAt)}</span><span>创建于 {dateTime(key.createdAt)}</span></div>
          <label className="switch" title={key.enabled ? '停用' : '启用'}><input type="checkbox" checked={key.enabled} disabled={busy === key.id} onChange={(event) => updateKey(key.id, { enabled: event.target.checked }, event.target.checked ? 'API Key 已启用' : 'API Key 已停用')} /><i /></label>
          <button className="icon-button danger" disabled={busy === key.id} title="删除" onClick={() => deleteKey(key.id)}><Trash2 size={17} /></button>
        </div>)}
      </div>
      <form className="security-form key-create" onSubmit={createKey}>
        <label>名称<input value={keyForm.name} maxLength="60" onChange={(event) => setKeyForm({ ...keyForm, name: event.target.value })} placeholder="例如：OpenCode" required /></label>
        <Button kind="primary" icon={Plus} busy={busy === 'key'} type="submit">创建 API Key</Button>
      </form>
    </section>
    <section className="settings-section">
      <div className="section-title"><div><h2>管理员密码</h2><p>修改后所有现有登录会话立即失效</p></div><LockKeyhole size={19} /></div>
      <form className="security-form" onSubmit={changePassword}>
        <label>当前密码<input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} required autoComplete="current-password" /></label>
        <label>新密码<input type="password" minLength="6" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} required autoComplete="new-password" /></label>
        <label>确认新密码<input type="password" minLength="6" value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} required autoComplete="new-password" /></label>
        <Button kind="primary" icon={LockKeyhole} busy={busy === 'password'} type="submit">修改密码</Button>
      </form>
      {error ? <div className="form-error">{error}</div> : null}
    </section>
    <ApiKeyResult apiKey={generatedKey} onClose={() => setGeneratedKey('')} notify={notify} />
  </>;
}

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [page, setPage] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState(null);
  const [loginNotice, setLoginNotice] = useState('');
  useEffect(() => { api('/api/admin/session').then((data) => setAuthenticated(data.authenticated)).catch(() => setAuthenticated(false)); }, []);
  const loadOverview = useCallback(async () => {
    setBusy(true);
    try { setOverview(await api('/api/admin/overview')); } catch (error) { if (error.status === 401) setAuthenticated(false); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (authenticated && page === 'overview') loadOverview(); }, [authenticated, page, loadOverview]);
  function notify(message, error = false) {
    setToast({ message, error });
    setTimeout(() => setToast(null), 3000);
  }
  if (authenticated === null) return <div className="loading"><RefreshCw className="spin" /></div>;
  if (!authenticated) return <Login notice={loginNotice} onLogin={() => { setLoginNotice(''); setAuthenticated(true); }} />;
  const navigation = [
    ['overview', LayoutDashboard, '总览'], ['accounts', UsersRound, '账号'], ['requests', Activity, '请求'], ['system', Settings2, '系统'],
  ];
  async function logout() { await api('/api/admin/logout', { method: 'POST' }); setAuthenticated(false); }
  return <div className="app-shell">
    <aside className={menu ? 'open' : ''}>
      <div className="brand"><CommandMark /><div><strong>Command Code</strong><span>Hub</span></div></div>
      <nav>{navigation.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setMenu(false); }}><Icon size={18} />{label}</button>)}</nav>
      <button className="logout" onClick={logout}><LogOut size={18} />退出登录</button>
    </aside>
    {menu ? <button className="scrim" onClick={() => setMenu(false)} aria-label="关闭菜单" /> : null}
    <div className="main-shell"><header className="mobile-header"><button className="icon-button" aria-label="打开菜单" title="打开菜单" onClick={() => setMenu(true)}><Menu /></button><div className="brand"><CommandMark /><strong>Command Code Hub</strong></div></header><main>
      {page === 'overview' ? <Overview data={overview} reload={loadOverview} busy={busy} /> : null}
      {page === 'accounts' ? <Accounts notify={notify} /> : null}
      {page === 'requests' ? <Requests /> : null}
      {page === 'system' ? <SystemPage notify={notify} onPasswordChanged={() => { setLoginNotice('密码已修改，请使用新密码重新登录'); setAuthenticated(false); }} /> : null}
    </main></div>
    {toast ? <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.message}</div> : null}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
