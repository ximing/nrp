import { normalizeClientSettings } from './settings';

const CLIENT_KEYS = new Set([
  'bind_port',
  'bind_host',
  'subdomain_host',
  'timeout',
  'retry',
  'backoff',
  'secret',
  'ping_interval',
  'log_file',
  'http',
  'dashboard_addr',
  'dashboard_port',
  'dashboard_user',
  'dashboard_pwd',
]);

const SERVER_KEYS = new Set([
  'port',
  'vhost_http_port',
  'vhost_https_port',
  'secret',
  'idle_timeout',
  'log_file',
  'dashboard_addr',
  'dashboard_port',
  'dashboard_user',
  'dashboard_pwd',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPort(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
}

export function applyClientPatch(current: unknown, patch: unknown) {
  if (!isRecord(current)) {
    return { ok: false as const, reason: 'config must be an object' };
  }
  if (!isRecord(patch)) {
    return { ok: false as const, reason: 'patch must be an object' };
  }
  for (const key of Object.keys(patch)) {
    if (!CLIENT_KEYS.has(key)) {
      return { ok: false as const, reason: `unknown field ${key}` };
    }
  }
  const next: Record<string, unknown> = { ...current, ...patch };
  const normalized = normalizeClientSettings(next);
  if (!normalized.ok) {
    return normalized;
  }
  const config: Record<string, unknown> = {
    ...next,
    bind_port: normalized.settings.bind_port,
    bind_host: normalized.settings.bind_host,
    timeout: normalized.settings.timeout,
    retry: normalized.settings.retry,
    backoff: normalized.settings.backoff,
    http: normalized.settings.http,
  };
  if (normalized.settings.subdomain_host !== undefined) {
    config.subdomain_host = normalized.settings.subdomain_host;
  }
  if (normalized.settings.secret !== undefined) {
    config.secret = normalized.settings.secret;
  }
  if (normalized.settings.ping_interval !== undefined) {
    config.ping_interval = normalized.settings.ping_interval;
  }
  if (normalized.settings.log_file !== undefined) {
    config.log_file = normalized.settings.log_file;
  }
  return { ok: true as const, config };
}

export function addClientProxy(current: unknown, entry: unknown) {
  if (!isRecord(current)) {
    return { ok: false as const, reason: 'config must be an object' };
  }
  if (!isRecord(entry)) {
    return { ok: false as const, reason: 'proxy must be an object' };
  }
  const name = entry.name;
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false as const, reason: 'proxy name is required' };
  }
  const http = isRecord(current.http) ? { ...current.http } : {};
  if (Object.prototype.hasOwnProperty.call(http, name)) {
    return { ok: false as const, reason: `proxy ${name} already exists` };
  }
  http[name] = { subdomain: entry.subdomain, local_port: entry.local_port };
  return applyClientPatch(current, { http });
}

export function applyServerPatch(current: unknown, patch: unknown) {
  if (!isRecord(current)) {
    return { ok: false as const, reason: 'config must be an object' };
  }
  if (!isRecord(patch)) {
    return { ok: false as const, reason: 'patch must be an object' };
  }
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!SERVER_KEYS.has(key)) {
      return { ok: false as const, reason: `unknown field ${key}` };
    }
    next[key] = value;
  }
  for (const key of ['port', 'vhost_http_port', 'vhost_https_port', 'dashboard_port']) {
    if (next[key] != null && !isPort(next[key])) {
      return { ok: false as const, reason: `${key} must be a numeric port` };
    }
  }
  if (
    next.idle_timeout != null &&
    (typeof next.idle_timeout !== 'number' || !Number.isFinite(next.idle_timeout) || next.idle_timeout <= 0)
  ) {
    return { ok: false as const, reason: 'idle_timeout must be a positive number' };
  }
  if (next.secret != null && typeof next.secret !== 'string') {
    return { ok: false as const, reason: 'secret must be a string' };
  }
  for (const key of ['dashboard_addr', 'dashboard_user', 'dashboard_pwd', 'log_file']) {
    if (next[key] != null && typeof next[key] !== 'string') {
      return { ok: false as const, reason: `${key} must be a string` };
    }
  }
  if (typeof next.port !== 'number' || typeof next.vhost_http_port !== 'number') {
    return { ok: false as const, reason: 'port and vhost_http_port are required' };
  }
  return { ok: true as const, config: next };
}
