import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Role = 'server' | 'client';

type Proxy = {
  subdomain: string;
  local_port: number;
};

type PanelConfig = {
  port?: number;
  vhost_http_port?: number;
  secret?: string;
  idle_timeout?: number;
  bind_host?: string;
  bind_port?: number;
  subdomain_host?: string;
  timeout?: number;
  retry?: number;
  ping_interval?: number;
  backoff?: { min?: number; max?: number; factor?: number };
  dashboard_addr?: string;
  dashboard_port?: number;
  dashboard_user?: string;
  dashboard_pwd?: string;
  http?: Record<string, Proxy>;
};

function apiUrl(path: string) {
  return new URL(path, `${window.location.protocol}//${window.location.host}`).toString();
}

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `请求失败 (${response.status})`);
  }
  return data as T;
}

function text(value: unknown) {
  return value == null ? '' : String(value);
}

function optionalNumber(value: unknown) {
  if (value === '' || value == null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  const id = label;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [draft, setDraft] = useState<PanelConfig | null>(null);
  const [proxyName, setProxyName] = useState('');
  const [proxySubdomain, setProxySubdomain] = useState('');
  const [proxyPort, setProxyPort] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [meta, config] = await Promise.all([
      callApi<{ role: Role }>('/api/meta'),
      callApi<PanelConfig>('/api/config'),
    ]);
    setRole(meta.role);
    setDraft(config);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  function update(patch: Partial<PanelConfig>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function save() {
    if (!draft || !role) {
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    const shared = {
      secret: draft.secret,
      dashboard_addr: draft.dashboard_addr,
      dashboard_port: optionalNumber(draft.dashboard_port),
      dashboard_user: draft.dashboard_user,
      dashboard_pwd: draft.dashboard_pwd,
    };
    const payload =
      role === 'server'
        ? {
            ...shared,
            port: optionalNumber(draft.port),
            vhost_http_port: optionalNumber(draft.vhost_http_port),
            idle_timeout: optionalNumber(draft.idle_timeout),
          }
        : {
            ...shared,
            bind_host: draft.bind_host,
            bind_port: optionalNumber(draft.bind_port),
            subdomain_host: draft.subdomain_host,
            timeout: optionalNumber(draft.timeout),
            retry: optionalNumber(draft.retry),
            ping_interval: optionalNumber(draft.ping_interval),
            backoff: {
              min: optionalNumber(draft.backoff?.min),
              max: optionalNumber(draft.backoff?.max),
              factor: optionalNumber(draft.backoff?.factor),
            },
            http: draft.http,
          };
    try {
      const saved = await callApi<PanelConfig>('/api/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setDraft(saved);
      setMessage('已写入配置文件。重新启动这条命令后生效。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function addProxy() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await callApi<PanelConfig>('/api/proxies', {
        method: 'POST',
        body: JSON.stringify({
          name: proxyName,
          subdomain: proxySubdomain,
          local_port: Number(proxyPort),
        }),
      });
      setDraft(saved);
      setProxyName('');
      setProxySubdomain('');
      setProxyPort('');
      setMessage('已添加代理并写入配置文件。重新启动客户端后生效。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  }

  if (!draft || !role) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">{error || '正在读取配置…'}</p>
      </main>
    );
  }

  const proxies = Object.entries(draft.http || {});

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">NRP</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {role === 'server' ? '服务端控制面板' : '客户端控制面板'}
        </h1>
        <p className="text-sm text-muted-foreground">修改会写回启动时使用的配置文件，重新启动后加载。</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{role === 'server' ? '服务' : '连接'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {role === 'server' ? (
            <>
              <Field label="控制端口 port" value={text(draft.port)} onChange={(port) => update({ port: Number(port) })} />
              <Field
                label="HTTP 端口 vhost_http_port"
                value={text(draft.vhost_http_port)}
                onChange={(vhost_http_port) => update({ vhost_http_port: Number(vhost_http_port) })}
              />
              <Field
                label="空闲超时 idle_timeout"
                value={text(draft.idle_timeout)}
                onChange={(idle_timeout) => update({ idle_timeout: Number(idle_timeout) })}
              />
            </>
          ) : (
            <>
              <Field label="服务端地址 bind_host" value={text(draft.bind_host)} onChange={(bind_host) => update({ bind_host })} />
              <Field
                label="服务端端口 bind_port"
                value={text(draft.bind_port)}
                onChange={(bind_port) => update({ bind_port: Number(bind_port) })}
              />
              <Field
                label="主机后缀 subdomain_host"
                value={text(draft.subdomain_host)}
                onChange={(subdomain_host) => update({ subdomain_host })}
              />
              <Field label="连接超时 timeout" value={text(draft.timeout)} onChange={(timeout) => update({ timeout: Number(timeout) })} />
              <Field label="重连次数 retry" value={text(draft.retry)} onChange={(retry) => update({ retry: Number(retry) })} />
              <Field
                label="心跳间隔 ping_interval"
                value={text(draft.ping_interval)}
                onChange={(ping_interval) => update({ ping_interval: Number(ping_interval) })}
              />
              <Field
                label="退避最小 backoff.min"
                value={text(draft.backoff?.min)}
                placeholder="100"
                onChange={(min) => update({ backoff: { ...draft.backoff, min: Number(min) } })}
              />
              <Field
                label="退避上限 backoff.max"
                value={text(draft.backoff?.max)}
                placeholder="1000"
                onChange={(max) => update({ backoff: { ...draft.backoff, max: Number(max) } })}
              />
              <Field
                label="退避倍数 backoff.factor"
                value={text(draft.backoff?.factor)}
                placeholder="2"
                onChange={(factor) => update({ backoff: { ...draft.backoff, factor: Number(factor) } })}
              />
            </>
          )}
          <Field label="共享密钥 secret" value={text(draft.secret)} onChange={(secret) => update({ secret })} type="password" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>面板登录</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="监听地址 dashboard_addr" value={text(draft.dashboard_addr)} onChange={(dashboard_addr) => update({ dashboard_addr })} />
          <Field
            label="监听端口 dashboard_port"
            value={text(draft.dashboard_port)}
            onChange={(dashboard_port) => update({ dashboard_port: Number(dashboard_port) })}
          />
          <Field label="用户名 dashboard_user" value={text(draft.dashboard_user)} onChange={(dashboard_user) => update({ dashboard_user })} />
          <Field
            label="密码 dashboard_pwd"
            value={text(draft.dashboard_pwd)}
            onChange={(dashboard_pwd) => update({ dashboard_pwd })}
            type="password"
          />
        </CardContent>
      </Card>

      {role === 'client' ? (
        <Card>
          <CardHeader>
            <CardTitle>HTTP 代理</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {proxies.map(([name, proxy]) => (
              <div key={name} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[8rem_1fr_8rem_auto]">
                <div className="grid gap-2">
                  <Label>名称</Label>
                  <Input value={name} disabled />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${name}-subdomain`}>子域名</Label>
                  <Input
                    id={`${name}-subdomain`}
                    value={proxy.subdomain}
                    onChange={(event) =>
                      update({
                        http: {
                          ...draft.http,
                          [name]: { ...proxy, subdomain: event.target.value },
                        },
                      })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${name}-port`}>本机端口</Label>
                  <Input
                    id={`${name}-port`}
                    value={text(proxy.local_port)}
                    onChange={(event) =>
                      update({
                        http: {
                          ...draft.http,
                          [name]: { ...proxy, local_port: Number(event.target.value) },
                        },
                      })
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const http = { ...draft.http };
                      delete http[name];
                      update({ http });
                    }}
                  >
                    移除
                  </Button>
                </div>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr_8rem_auto]">
              <div className="grid gap-2">
                <Label htmlFor="proxy-name">名称</Label>
                <Input id="proxy-name" value={proxyName} onChange={(event) => setProxyName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proxy-subdomain">子域名</Label>
                <Input
                  id="proxy-subdomain"
                  value={proxySubdomain}
                  onChange={(event) => setProxySubdomain(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proxy-port">本机端口</Label>
                <Input id="proxy-port" value={proxyPort} onChange={(event) => setProxyPort(event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="secondary" disabled={busy} onClick={addProxy}>
                  添加
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" disabled={busy} onClick={save}>
          保存配置
        </Button>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </main>
  );
}
