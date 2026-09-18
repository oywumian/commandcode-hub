import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Check, ChevronRight, CircleDollarSign, Clock3, Gauge, KeyRound,
  LayoutDashboard, LogOut, Menu, Plus, RefreshCw, Server, Settings2, Trash2,
  UserRound, UsersRound, X,
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

function Stat({ icon: Icon, label, value, detail }) {
  return <article className="stat">
    <div className="stat-icon"><Icon size={18} /></div>
    <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
  </article>;
}

function Login({ onLogin }) {
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
          <LineChart data={quotaChart}><CartesianGrid stroke="#e1e5e0" vertical={false} /><XAxis dataKey="time" minTickGap={36} /><YAxis /><Tooltip /><Line type="monotone" dataKey="fiveHour" name="5 小时" stroke="#d06437" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="weekly" name="每周" stroke="#287e68" dot={false} strokeWidth={2} /></LineChart>
        </ResponsiveContainer> : <Empty>还没有额度快照。</Empty>}
      </div>
      <div className="chart-panel">
        <div className="section-title"><div><h2>请求趋势</h2><p>最近 24 小时</p></div></div>
        {requestChart.length ? <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={requestChart}><CartesianGrid stroke="#e1e5e0" vertical={false} /><XAxis dataKey="time" minTickGap={36} /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="requests" name="请求" stroke="#287e68" fill="#dcece6" strokeWidth={2} /></AreaChart>
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
    {accounts.length ? <div className="table-wrap"><table><thead><tr><th>账号</th><th>套餐</th><th>额度状态</th><th>最近更新</th><th>启用</th><th /></tr></thead><tbody>
      {accounts.map((account) => <tr key={account.id}>
        <td><div className="account-cell"><span className={`avatar ${account.isDefault ? 'active' : ''}`}><UserRound size={17} /></span><div><strong>{account.name}</strong><small>{account.maskedKey}</small></div>{account.isDefault ? <span className="tag">默认</span> : null}</div></td>
        <td>{account.planName || '不可用'}</td>
        <td>{account.lastError ? <span className="bad">异常</span> : account.quota ? <span className="good">正常</span> : '未获取'}</td>
        <td>{dateTime(account.lastQuotaAt)}</td>
        <td><label className="switch"><input type="checkbox" checked={account.enabled} onChange={(e) => action(`enable-${account.id}`, () => api(`/api/admin/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ enabled: e.target.checked }) }), '账号状态已更新')} /><i /></label></td>
        <td><div className="row-actions">
          {!account.isDefault ? <button className="icon-button" title="设为默认" onClick={() => action(`default-${account.id}`, () => api(`/api/admin/accounts/${account.id}/default`, { method: 'POST' }), '默认账号已切换')}><Check size={17} /></button> : null}
          <button className="icon-button" title="刷新额度" onClick={() => action(`refresh-${account.id}`, () => api(`/api/admin/accounts/${account.id}/refresh`, { method: 'POST' }), '额度已刷新')}><RefreshCw className={busy === `refresh-${account.id}` ? 'spin' : ''} size={17} /></button>
          <button className="icon-button danger" title="删除" onClick={() => confirm(`删除账号“${account.name}”？`) && action(`delete-${account.id}`, () => api(`/api/admin/accounts/${account.id}`, { method: 'DELETE' }), '账号已删除')}><Trash2 size={17} /></button>
        </div></td>
      </tr>)}
    </tbody></table></div> : <Empty>还没有账号。</Empty>}
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

function SystemPage() {
  const [runtime, setRuntime] = useState(null);
  useEffect(() => { api('/api/admin/runtime').then(setRuntime); }, []);
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
  return <><div className="page-heading"><div><p className="eyebrow">运行环境</p><h1>系统</h1></div></div><section className="system-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section></>;
}

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [page, setPage] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState(null);
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
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
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
      {page === 'system' ? <SystemPage /> : null}
    </main></div>
    {toast ? <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.message}</div> : null}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
