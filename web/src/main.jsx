import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Boxes, Check, ChevronRight, CircleDollarSign, Clock3, Copy, Cpu, Gauge, KeyRound,
  LayoutDashboard, LockKeyhole, LogOut, Menu, Pause, Play, Plus, RefreshCw, Search, Server,
  Settings2, ShieldCheck, Timer, Terminal, Trash2, UsersRound, X, Zap,
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
const decimal = (value) => value === null || value === undefined || value === '' ? '不可用' : Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const credits = (value) => value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const rate = (value) => {
  if (value === null || value === undefined) return '—';
  const number = Number(value);
  const digits = Math.abs(number) > 0 && Math.abs(number) < 0.01 ? 4 : Math.abs(number) < 1 ? 3 : 2;
  return `$${number.toLocaleString('zh-CN', { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits })}`;
};
const duration = (value) => value >= 1000 ? `${(value / 1000).toFixed(1)} 秒` : `${Math.round(value || 0)} 毫秒`;
const percent = (used, cap) => cap > 0 && used !== null ? Math.min(100, Math.max(0, used / cap * 100)) : null;
const preciseTime = (value) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date(value));

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
      <span>{ratio === null ? '无百分比' : `${ratio.toFixed(2)}%`}</span>
      <span>{resetAt ? `重置 ${dateTime(resetAt)}` : '无重置时间'}</span>
    </div>
  </article>;
}

function AccountQuotaMeter({ label, used, cap, resetAt, estimated }) {
  const ratio = percent(used, cap);
  const tone = ratio === null ? '' : ratio >= 80 ? 'danger' : ratio >= 50 ? 'warn' : 'ok';
  return <div className="account-meter">
    <div className="account-meter-head">
      <span>{label}{estimated ? <small>估算</small> : null}</span>
      <strong className={tone}>{ratio === null ? '不可用' : `已用 ${ratio.toFixed(1)}%`}</strong>
    </div>
    <div className="account-meter-track"><i className={tone} style={{ width: `${ratio ?? 0}%` }} /></div>
    <div className="account-meter-foot">
      <span>{used === null || cap === null ? '额度不可用' : `已用 ${decimal(used)} / ${decimal(cap)}`}</span>
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
  const activeAccounts = (data?.accounts || []).filter((item) => item.enabled && item.quota);
  const quota = activeAccounts.length ? {
    credits: {
      fiveHour: aggregateWindow(activeAccounts, 'fiveHour'),
      weekly: aggregateWindow(activeAccounts, 'weekly'),
      monthlyCredits: sumQuota(activeAccounts, (item) => item.quota.credits?.monthlyCredits),
      purchasedCredits: sumQuota(activeAccounts, (item) => item.quota.credits?.purchasedCredits),
      freeCredits: sumQuota(activeAccounts, (item) => item.quota.credits?.freeCredits),
    },
    monthly: aggregateMonthly(activeAccounts),
  } : null;
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
    {!quota ? <Empty>请先在“账号”中添加并获取额度。</Empty> : <>
      <section className="section-block">
        <div className="section-title"><div><h2>全部已启用账号</h2><p>{activeAccounts.length} 个账号合计 · 更新于 {dateTime(Math.max(...activeAccounts.map((item) => item.lastQuotaAt || 0)))}</p></div><span className="status-dot">额度合计</span></div>
        <div className="quota-grid">
          <QuotaMeter label="5 小时额度" value={quota?.credits?.fiveHour?.used ?? null} cap={quota?.credits?.fiveHour?.cap ?? null} resetAt={quota?.credits?.fiveHour?.resetAt} />
          <QuotaMeter label="每周额度" value={quota?.credits?.weekly?.used ?? null} cap={quota?.credits?.weekly?.cap ?? null} resetAt={quota?.credits?.weekly?.resetAt} />
          <QuotaMeter label="每月额度" value={quota?.monthly?.used ?? null} cap={quota?.monthly?.cap ?? null} remaining={quota?.monthly?.remaining ?? null} resetAt={quota?.monthly?.resetAt} estimated={quota?.monthly?.estimated} />
        </div>
        <div className="credit-strip">
          <span>月度余额 <strong>{decimal(quota?.credits?.monthlyCredits)}</strong></span>
          <span>购买额度 <strong>{decimal(quota?.credits?.purchasedCredits)}</strong></span>
          <span>免费额度 <strong>{decimal(quota?.credits?.freeCredits)}</strong></span>
        </div>
      </section>
      {account.lastError ? <div className="notice error">{account.lastError}</div> : null}
    </>}
    <section className="chart-grid">
      <div className="chart-panel">
        <div className="section-title"><div><h2>默认账号额度趋势</h2><p>最近 30 天</p></div></div>
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

function sumQuota(accounts, read) {
  const values = accounts.map(read).filter((value) => Number.isFinite(Number(value))).map(Number);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function aggregateWindow(accounts, key) {
  const windows = accounts.map((item) => item.quota?.credits?.[key]).filter(Boolean);
  const used = sumQuota(windows, (item) => item.used);
  const cap = sumQuota(windows, (item) => item.cap);
  return {
    used,
    cap,
    exceeded: windows.some((item) => item.exceeded),
    resetAt: null,
  };
}

function aggregateMonthly(accounts) {
  const monthly = accounts.map((item) => item.quota?.monthly).filter(Boolean);
  const used = sumQuota(monthly, (item) => item.used);
  const cap = sumQuota(monthly, (item) => item.cap);
  const remaining = sumQuota(monthly, (item) => item.remaining);
  return {
    used,
    cap,
    remaining,
    resetAt: null,
    estimated: monthly.some((item) => item.estimated),
  };
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
  const [routingMode, setRoutingMode] = useState('default');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState(false);
  const load = useCallback(async () => {
    const [accountData, routingData] = await Promise.all([api('/api/admin/accounts'), api('/api/admin/routing')]);
    setAccounts(accountData.accounts || []);
    setRoutingMode(routingData.mode || 'default');
  }, []);
  useEffect(() => { load(); }, [load]);
  async function action(key, fn, message) {
    setBusy(key);
    try { await fn(); await load(); notify(message); } catch (error) { notify(error.message, true); } finally { setBusy(''); }
  }
  async function changeRoutingMode(event) {
    const mode = event.target.value;
    setBusy('routing');
    try {
      const data = await api('/api/admin/routing', { method: 'PUT', body: JSON.stringify({ mode }) });
      setRoutingMode(data.mode);
      notify(data.mode === 'auto' ? '已开启自动账号路由' : '已切回默认账号路由');
    } catch (error) { notify(error.message, true); } finally { setBusy(''); }
  }
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">身份与路由</p><h1>账号</h1></div>
      <div className="actions"><Button icon={RefreshCw} busy={busy === 'all'} onClick={() => action('all', () => api('/api/admin/quotas/refresh', { method: 'POST' }), '全部额度已刷新')}>刷新全部</Button><Button kind="primary" icon={Plus} onClick={() => setDialog(true)}>添加账号</Button></div>
    </div>
    <div className="toolbar-line">
      <Button icon={KeyRound} busy={busy === 'import'} onClick={() => action('import', () => api('/api/admin/accounts/import', { method: 'POST' }), '认证文件已导入')}>从本机认证文件导入</Button>
      <label className="routing-select">API 路由
        <select value={routingMode} onChange={changeRoutingMode} disabled={busy === 'routing'}>
          <option value="default">固定默认账号</option>
          <option value="auto">自动选择健康账号</option>
        </select>
      </label>
      <span className="routing-note">{routingMode === 'auto' ? '请求会优先使用 5 小时和周额度更充足的账号' : '所有请求使用标记为默认路由的账号'}</span>
      <span>{accounts.length} 个账号</span>
    </div>
    {accounts.length ? <div className="account-grid">
      {accounts.map((account) => {
        const credits = account.quota?.credits;
        const monthly = account.quota?.monthly;
        const monthlyUsed = monthly?.used ?? (monthly?.cap !== null && monthly?.cap !== undefined && credits?.monthlyCredits !== null && credits?.monthlyCredits !== undefined
          ? Math.max(0, monthly.cap - credits.monthlyCredits)
          : null);
        const monthlyBalance = monthly?.remaining ?? credits?.monthlyCredits ?? null;
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
            <span>月度已用<strong>{decimal(monthlyUsed)}</strong></span>
            <span>月度余额<strong>{decimal(monthlyBalance)}</strong></span>
            <span>购买额度<strong>{decimal(credits?.purchasedCredits)}</strong></span>
            <span>免费额度<strong>{decimal(credits?.freeCredits)}</strong></span>
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
    <p className="model-pricing-note request-pricing-note"><CircleDollarSign size={14} />额度按 Go 官方参考价和该次请求的 Token 估算；实际扣费以 Command Code Studio 为准。</p>
    <div className="table-wrap"><table><thead><tr><th>时间</th><th>账号</th><th>接口</th><th>模型</th><th>状态</th><th>Token</th><th>额度</th><th>耗时</th></tr></thead><tbody>
      {(data?.requests || []).map((row) => <tr key={row.id}><td>{dateTime(row.created_at)}</td><td>{row.account_name || '已删除'}</td><td><code>{row.path}</code>{row.streaming ? <span className="tag subtle">流式</span> : null}</td><td>{row.model || '未知'}</td><td><span className={row.status >= 200 && row.status < 400 ? 'good' : 'bad'}>{row.status}</span></td><td>{whole(row.input_tokens + row.output_tokens)}</td><td className="request-credits" title="按 Go 官方参考价估算；实际扣费以 Command Code Studio 为准。">{credits(row.estimated_credits)}</td><td>{duration(row.duration_ms)}</td></tr>)}
    </tbody></table>{!data?.requests?.length ? <Empty>所选时间内没有请求。</Empty> : null}</div>
  </>;
}

const terminalKind = {
  received: '请求',
  upstream: '上游',
  first_byte: '首字',
  completed: '完成',
  error: '错误',
};

function TerminalPage({ notify }) {
  const [days, setDays] = useState(1);
  const [data, setData] = useState(null);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      setData(await api(`/api/admin/terminal?days=${days}&limit=300`));
    } finally {
      if (!silent) setBusy(false);
    }
  }, [days]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => load(true), 3000);
    return () => clearInterval(timer);
  }, [live, load]);
  const stats = data?.stats || {};
  const events = (data?.events || []).filter((event) => {
    if (level === 'issues' && !['error', 'warn'].includes(event.level)) return false;
    if (level === 'streaming' && !event.streaming) return false;
    const text = [event.message, event.model, event.client, event.path, event.detail].join(' ').toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  async function clearEvents() {
    await api('/api/admin/terminal/clear', { method: 'POST' });
    await load(true);
    notify('终端记录已清空');
  }
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">实时请求观测</p><h1>终端</h1></div>
      <div className="actions">
        <div className="segmented">{[[1, '24 小时'], [3, '3 天'], [7, '7 天']].map(([value, label]) => <button className={days === value ? 'active' : ''} onClick={() => setDays(value)} key={value}>{label}</button>)}</div>
        <Button icon={live ? Pause : Play} onClick={() => setLive(!live)}>{live ? '暂停' : '继续'}</Button>
        <Button icon={RefreshCw} busy={busy} onClick={() => load()}>刷新</Button>
        <Button icon={Trash2} onClick={clearEvents}>清空</Button>
      </div>
    </div>
    <section className="stats-grid terminal-stats">
      <Stat icon={Terminal} label="最近 75 次请求" value={whole(stats.totalRequests)} detail="已完成" />
      <Stat icon={Timer} label="末次延迟" value={duration(stats.lastLatencyMs)} detail={stats.lastTtftMs === null || stats.lastTtftMs === undefined ? '无首字数据' : `首字 ${duration(stats.lastTtftMs)}`} />
      <Stat icon={Zap} label="缓存命中" value={stats.cacheHitRate === null || stats.cacheHitRate === undefined ? '不可用' : `约 ${stats.cacheHitRate}%`} detail={`输入 Token ${whole(stats.inputTokens)}`} />
      <Stat icon={Cpu} label="客户端" value={stats.lastClient || '等待调用'} detail={stats.lastModel || '暂无模型'} />
    </section>
    <div className="terminal-toolbar">
      <label className="terminal-search">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型、客户端、路径或事件" />
      </label>
      <div className="segmented">{[['all', '全部'], ['streaming', '流式'], ['issues', '异常']].map(([value, label]) => <button className={level === value ? 'active' : ''} onClick={() => setLevel(value)} key={value}>{label}</button>)}</div>
    </div>
    <section className="terminal-panel">
      <div className="terminal-head">
        <span><i className={live ? 'live-dot' : 'live-dot paused'} />{live ? '实时采集' : '已暂停'}</span>
        <span>{events.length} 条事件</span>
      </div>
      <div className="terminal-log">
        {events.map((event) => <article className={`terminal-line ${event.level}`} key={event.id}>
          <span className="terminal-time">{preciseTime(event.created_at)}</span>
          <span className="terminal-kind">{terminalKind[event.event] || event.event}</span>
          <div className="terminal-copy">
            <p>{event.message}</p>
            <small>{[event.client, event.model, event.path, event.detail].filter(Boolean).join(' · ')}</small>
          </div>
          <div className="terminal-metrics">
            {event.status !== null && event.status !== undefined ? <span>{event.status}</span> : null}
            {event.ttft_ms !== null && event.ttft_ms !== undefined ? <span>TTFT {duration(event.ttft_ms)}</span> : null}
            {event.duration_ms !== null && event.duration_ms !== undefined ? <span>{duration(event.duration_ms)}</span> : null}
            {event.input_tokens || event.output_tokens ? <span>{whole(event.input_tokens)} / {whole(event.output_tokens)}</span> : null}
            {event.tool_count ? <span>{event.tool_count} 工具</span> : null}
          </div>
        </article>)}
        {!events.length ? <div className="terminal-empty">{live ? '等待实时请求…' : '没有匹配的事件。'}</div> : null}
      </div>
    </section>
  </>;
}

function ModelsPage({ notify }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [models, setModels] = useState([]);
  const [usage, setUsage] = useState(null);
  const [pricingMeta, setPricingMeta] = useState(null);
  const [testJob, setTestJob] = useState({ status: 'idle' });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/admin/accounts');
      const next = data.accounts || [];
      setAccounts(next);
      setAccountId((current) => next.some((account) => account.id === current)
        ? current
        : (next.find((account) => account.isDefault)?.id || next[0]?.id || ''));
      if (!next.length) setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!accountId) {
      setModels([]);
      setUsage(null);
      setPricingMeta(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api(`/api/admin/models?accountId=${encodeURIComponent(accountId)}`);
      setModels(data.models || []);
      setUsage(data.usage || null);
      setPricingMeta(data.pricingMeta || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const loadTestStatus = useCallback(async () => {
    if (!accountId) {
      setTestJob({ status: 'idle' });
      return null;
    }
    const data = await api(`/api/admin/models/test?accountId=${encodeURIComponent(accountId)}`);
    setTestJob(data.job || { status: 'idle' });
    return data.job || null;
  }, [accountId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => {
    load();
    loadTestStatus().catch(() => setTestJob({ status: 'idle' }));
  }, [load, loadTestStatus]);

  useEffect(() => {
    if (testJob.status !== 'running' || !accountId) return undefined;
    const timer = setInterval(async () => {
      try {
        const job = await loadTestStatus();
        if (job && job.status !== 'running') {
          await load();
          notify(job.status === 'completed' ? `检测完成：可用 ${job.available}，停用 ${job.unavailable}` : `检测失败：${job.error || '未知错误'}`);
        }
      } catch {}
    }, 1200);
    return () => clearInterval(timer);
  }, [testJob.status, accountId, load, loadTestStatus, notify]);

  const selectedAccount = accounts.find((account) => account.id === accountId) || null;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleModels = models.filter((model) => {
    if (!normalizedQuery) return true;
    return String(model.id || '').toLowerCase().includes(normalizedQuery)
      || String(model.pricing?.name || '').toLowerCase().includes(normalizedQuery);
  });
  const enabledCount = models.filter((model) => model.enabled).length;
  const progress = testJob.total ? Math.round(testJob.completed / testJob.total * 100) : 0;
  const usageByModel = new Map((usage?.models || []).map((item) => [item.modelId, item]));
  const creditsUsed = usage?.credits?.value ?? null;

  async function copyModel(id) {
    await navigator.clipboard.writeText(id);
    notify('模型 ID 已复制');
  }

  async function startTest() {
    if (!accountId) return;
    setTesting(true);
    setError('');
    try {
      const data = await api('/api/admin/models/test', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      });
      setTestJob(data.job);
      notify('可用性检测已开始');
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  function modelState(model) {
    if (model.enabled === false) return { key: 'unavailable', label: '不可用' };
    if (model.status === 'available') return { key: 'available', label: '可用' };
    if (model.status === 'unknown') return { key: 'unknown', label: '待确认' };
    return { key: 'untested', label: '未检测' };
  }

  function pricingTitle(pricing) {
    if (!pricing) return '官方价格表未提供该模型报价';
    const lines = [`输入 ${rate(pricing.input)} / 1M`, `输出 ${rate(pricing.output)} / 1M`, `缓存读 ${rate(pricing.cacheRead)} / 1M`];
    if (pricing.cacheWrite !== null) lines.push(`缓存写 ${rate(pricing.cacheWrite)} / 1M`);
    if (pricing.original) lines.push(`折扣前：输入 ${rate(pricing.original.input)}，输出 ${rate(pricing.original.output)}，缓存读 ${rate(pricing.original.cacheRead)}`);
    if (pricing.timeOfDay) lines.push(`${pricing.timeOfDay.label}；高峰时段 ${pricing.timeOfDay.window}`);
    return lines.join('\n');
  }

  function PricingCell({ pricing }) {
    if (!pricing) return <span className="model-price-empty">—</span>;
    const tags = [];
    if (pricing.discountPercent) tags.push(`-${pricing.discountPercent}%`);
    if (pricing.timeOfDay) tags.push(pricing.timeOfDay.label);
    return <div className="model-price-stack" title={pricingTitle(pricing)}>
      <strong>{pricing.free ? '免费' : `${rate(pricing.input)} / ${rate(pricing.output)}`}</strong>
      <small>{pricing.free ? 'Go 套餐' : `缓存读 ${rate(pricing.cacheRead)}`}{tags.length ? ` · ${tags.join(' · ')}` : ''}</small>
    </div>;
  }

  function UsageCreditsCell({ usageItem }) {
    if (!usageItem || usageItem.estimatedCredits === null || usageItem.estimatedCredits === undefined) return <span className="model-price-empty">—</span>;
    return <span className="model-credits" title="按 Go 官方参考价估算；普通输入、输出和缓存读 Token 分别计价，实际扣费以 Command Code Studio 为准。">{credits(usageItem.estimatedCredits)}</span>;
  }

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">账号权限目录</p><h1>模型库</h1></div>
      <div className="actions">
        <Button icon={Activity} kind="primary" busy={testing || testJob.status === 'running'} disabled={!accountId || testJob.status === 'running'} onClick={startTest}>检测可用性</Button>
        <Button icon={RefreshCw} busy={loading} onClick={load}>刷新目录</Button>
      </div>
    </div>
    <div className="terminal-toolbar model-toolbar">
      <label className="model-account">账号
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={!accounts.length}>
          {!accounts.length ? <option value="">暂无账号</option> : null}
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? '（默认）' : ''}</option>)}
        </select>
      </label>
      <label className="terminal-search">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型 ID 或名称" />
      </label>
      <span>{visibleModels.length} / {models.length} 个模型</span>
    </div>
    {selectedAccount ? <>
      <p className="model-account-note">「{selectedAccount.name}」已启用 {enabledCount} / {models.length}；终端 /v1/models 只返回已启用模型。</p>
      <div className="model-usage-strip">
        <span><small>今日请求</small><strong>{whole(usage?.requests)}</strong></span>
        <span><small>今日输入 Token</small><strong>{whole(usage?.inputTokens)}</strong></span>
        <span><small>今日输出 Token</small><strong>{whole(usage?.outputTokens)}</strong></span>
        <span><small>今日总 Token</small><strong>{whole(usage?.totalTokens)}</strong></span>
        <span><small>今日已消耗额度</small><strong className={creditsUsed === null ? 'muted' : ''}>{creditsUsed === null ? '暂无数据' : decimal(creditsUsed)}</strong></span>
        <span><small>今日参考额度</small><strong className={usage?.estimatedCredits === null ? 'muted' : ''}>{credits(usage?.estimatedCredits)}</strong></span>
      </div>
      {pricingMeta ? <p className="model-pricing-note"><CircleDollarSign size={14} />Go 套餐参考价，更新于 {pricingMeta.capturedAt}；<a href={pricingMeta.sourceUrl} target="_blank" rel="noreferrer">查看官方价格</a>。实际扣费以 Command Code Studio 为准。</p> : null}
    </> : null}
    {testJob.status !== 'idle' ? <section className={`model-test-panel ${testJob.status}`}>
      <div className="model-test-head">
        <strong>{testJob.status === 'running' ? '正在检测账号权限' : testJob.status === 'failed' ? '检测未完成' : '检测完成'}</strong>
        <span>{testJob.status === 'failed' ? testJob.error : `${testJob.completed} / ${testJob.total}`}</span>
      </div>
      <div className="model-test-track"><i style={{ width: `${progress}%` }} /></div>
      <div className="model-test-foot"><span>{testJob.current ? `当前 ${testJob.current}` : '仅停用明确无权限的模型'}</span><span>可用 {testJob.available} · 停用 {testJob.unavailable} · 待确认 {testJob.unknown}</span></div>
    </section> : null}
    {error ? <div className="notice error">{error}</div> : null}
    {visibleModels.length ? <div className="model-table-wrap">
      <table className="model-table">
        <colgroup><col className="model-col-id" /><col className="model-col-state" /><col className="model-col-price" /><col className="model-col-tokens" /><col className="model-col-credits" /><col className="model-col-owner" /><col className="model-col-tested" /><col className="model-col-action" /></colgroup>
        <thead><tr><th>模型 ID</th><th>状态</th><th>Go 参考价 /1M</th><th>今日 Token</th><th>今日参考额度</th><th>来源</th><th>检测时间</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>
      {visibleModels.map((model) => {
        const state = modelState(model);
            return <tr key={model.id} className={`model-row ${state.key}`}>
              <td><div className="model-id-cell"><Boxes size={16} /><code title={model.id}>{model.id}</code></div></td>
              <td><span className={`model-state ${state.key}`}>{state.label}</span></td>
              <td><PricingCell pricing={model.pricing} /></td>
              <td className="model-tokens">{whole(usageByModel.get(model.id)?.totalTokens)}</td>
              <td><UsageCreditsCell usageItem={usageByModel.get(model.id)} /></td>
              <td className="model-owner">{model.owned_by || '上游模型'}</td>
              <td className="model-tested" title={model.error || ''}>{model.testedAt ? dateTime(model.testedAt) : '未检测'}</td>
              <td><button className="icon-button model-copy" title="复制模型 ID" onClick={() => copyModel(model.id)}><Copy size={15} /></button></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div> : <Empty>{loading ? '正在读取该账号的模型…' : accounts.length ? '没有匹配模型。' : '请先添加 Command Code 账号。'}</Empty>}
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
    ['overview', LayoutDashboard, '总览'], ['accounts', UsersRound, '账号'], ['requests', Activity, '请求'], ['terminal', Terminal, '终端'], ['models', Boxes, '模型库'], ['system', Settings2, '系统'],
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
      {page === 'terminal' ? <TerminalPage notify={notify} /> : null}
      {page === 'models' ? <ModelsPage notify={notify} /> : null}
      {page === 'system' ? <SystemPage notify={notify} onPasswordChanged={() => { setLoginNotice('密码已修改，请使用新密码重新登录'); setAuthenticated(false); }} /> : null}
    </main></div>
    {toast ? <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.message}</div> : null}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
