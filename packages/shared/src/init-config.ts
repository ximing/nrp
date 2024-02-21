import { applyServerPatch } from './config-edit';
import { normalizeClientSettings } from './settings';
import { ProxyItem } from './tui-proxy';

export type InitConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; reason: string };

export interface ServerInitInput {
  port: string;
  vhost_http_port: string;
  secret: string;
  idle_timeout: string;
  panel: string;
  dashboard_addr?: string;
  dashboard_port?: string;
  dashboard_user?: string;
  dashboard_pwd?: string;
}

export interface ClientInitInput {
  bind_host: string;
  bind_port: string;
  subdomain_host: string;
  secret: string;
  panel: string;
  dashboard_addr?: string;
  dashboard_port?: string;
  dashboard_user?: string;
  dashboard_pwd?: string;
  timeout: string;
  retry: string;
  backoff_min: string;
  backoff_max: string;
  backoff_factor: string;
  ping_interval: string;
  proxies: ProxyItem[];
}

function integerOrRaw(value: string): number | string {
  if (/^[0-9]+$/.test(value)) {
    return Number(value);
  }
  return value;
}

function readInteger(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }
  return Number(value);
}

export function buildServerInitConfig(input: ServerInitInput): InitConfigResult {
  if (typeof input.secret !== 'string' || input.secret.length === 0) {
    return { ok: false, reason: 'secret is required' };
  }
  const patch: Record<string, unknown> = {
    port: integerOrRaw(input.port),
    vhost_http_port: integerOrRaw(input.vhost_http_port),
    secret: input.secret,
    idle_timeout: integerOrRaw(input.idle_timeout),
  };
  if (input.panel === 'yes') {
    if (!input.dashboard_user || !input.dashboard_pwd) {
      return { ok: false, reason: 'dashboard user and password are required' };
    }
    patch.dashboard_addr = input.dashboard_addr || '127.0.0.1';
    patch.dashboard_port = integerOrRaw(input.dashboard_port ?? '');
    patch.dashboard_user = input.dashboard_user;
    patch.dashboard_pwd = input.dashboard_pwd;
  }
  const result = applyServerPatch({}, patch);
  if (!result.ok) {
    return result;
  }
  return { ok: true, config: result.config };
}

export function buildClientInitConfig(input: ClientInitInput): InitConfigResult {
  if (typeof input.secret !== 'string' || input.secret.length === 0) {
    return { ok: false, reason: 'secret is required' };
  }
  if (typeof input.subdomain_host !== 'string' || input.subdomain_host.length === 0) {
    return { ok: false, reason: 'subdomain_host is required' };
  }
  if (!Array.isArray(input.proxies) || input.proxies.length < 1) {
    return { ok: false, reason: 'http requires at least one entry' };
  }
  const timeout = readInteger(input.timeout);
  const retry = readInteger(input.retry);
  const backoffMin = readInteger(input.backoff_min);
  const backoffMax = readInteger(input.backoff_max);
  const backoffFactor = readInteger(input.backoff_factor);
  const ping = readInteger(input.ping_interval);
  if (
    timeout == null ||
    retry == null ||
    backoffMin == null ||
    backoffMax == null ||
    backoffFactor == null ||
    ping == null
  ) {
    return { ok: false, reason: 'timeout, retry, backoff, and ping_interval must be numbers' };
  }
  const http: Record<string, { subdomain: string; local_port: number | string }> = {};
  for (const proxy of input.proxies) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(proxy.name)) {
      return { ok: false, reason: `invalid proxy name ${proxy.name}` };
    }
    if (Object.prototype.hasOwnProperty.call(http, proxy.name)) {
      return { ok: false, reason: `proxy ${proxy.name} already exists` };
    }
    if (typeof proxy.subdomain !== 'string' || proxy.subdomain.length === 0 || /\s/.test(proxy.subdomain)) {
      return { ok: false, reason: `http.${proxy.name}.subdomain is required` };
    }
    const localPort = readInteger(proxy.local_port);
    http[proxy.name] = {
      subdomain: proxy.subdomain,
      local_port: localPort == null ? proxy.local_port : localPort,
    };
  }
  const normalized = normalizeClientSettings({
    bind_host: input.bind_host,
    bind_port: integerOrRaw(input.bind_port),
    subdomain_host: input.subdomain_host,
    secret: input.secret,
    timeout,
    retry,
    backoff: { min: backoffMin, max: backoffMax, factor: backoffFactor },
    ping_interval: ping,
    http,
  });
  if (!normalized.ok) {
    return normalized;
  }
  const config: Record<string, unknown> = {
    bind_host: normalized.settings.bind_host,
    bind_port: normalized.settings.bind_port,
    subdomain_host: normalized.settings.subdomain_host,
    secret: normalized.settings.secret,
    timeout: normalized.settings.timeout,
    retry: normalized.settings.retry,
    backoff: normalized.settings.backoff,
    ping_interval: normalized.settings.ping_interval,
    http: normalized.settings.http,
  };
  if (input.panel === 'yes') {
    if (!input.dashboard_user || !input.dashboard_pwd) {
      return { ok: false, reason: 'dashboard user and password are required' };
    }
    const dashboardPort = readInteger(input.dashboard_port ?? '');
    if (dashboardPort == null || dashboardPort > 65535) {
      return { ok: false, reason: 'dashboard_port must be a numeric port' };
    }
    config.dashboard_addr = input.dashboard_addr || '127.0.0.1';
    config.dashboard_port = dashboardPort;
    config.dashboard_user = input.dashboard_user;
    config.dashboard_pwd = input.dashboard_pwd;
  }
  return { ok: true, config };
}
