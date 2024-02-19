import { ClientHttpSetting } from './types';

export const DEFAULT_CLIENT_TIMEOUT = 10000;
export const DEFAULT_CLIENT_RETRY = 3;
export const DEFAULT_BACKOFF = { min: 100, max: 1000, factor: 2 };
export const DEFAULT_IDLE_TIMEOUT = 60000;
export const DEFAULT_PING_INTERVAL = 10000;

export interface NormalizedClientSettings {
  bind_port: number;
  bind_host: string;
  subdomain_host?: string;
  timeout: number;
  retry: number;
  log_file?: string;
  backoff: {
    min: number;
    max: number;
    factor: number;
  };
  http: ClientHttpSetting;
  secret?: string;
  ping_interval?: number;
}

export type SettingsResult =
  | { ok: true; settings: NormalizedClientSettings }
  | { ok: false; reason: string };

function asPort(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      return null;
    }
    return value;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (parsed <= 65535) {
      return parsed;
    }
  }
  return null;
}

function finiteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

export function normalizeClientSettings(input: unknown): SettingsResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'settings must be an object' };
  }
  const raw = input as Record<string, unknown>;
  const bindPort = asPort(raw.bind_port);
  if (bindPort == null) {
    return { ok: false, reason: 'bind_port must be a numeric port' };
  }
  if (typeof raw.bind_host !== 'string' || raw.bind_host.length === 0) {
    return { ok: false, reason: 'bind_host is required' };
  }
  if (!raw.http || typeof raw.http !== 'object' || Array.isArray(raw.http)) {
    return { ok: false, reason: 'http is required' };
  }
  const entries = Object.entries(raw.http as Record<string, unknown>);
  if (entries.length < 1) {
    return { ok: false, reason: 'http requires at least one entry' };
  }
  const http: ClientHttpSetting = {};
  for (const [name, entry] of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: `http.${name} is invalid` };
    }
    const record = entry as { subdomain?: unknown; local_port?: unknown };
    if (typeof record.subdomain !== 'string' || record.subdomain.length === 0) {
      return { ok: false, reason: `http.${name}.subdomain is required` };
    }
    const localPort = asPort(record.local_port);
    if (localPort == null) {
      return { ok: false, reason: `http.${name}.local_port must be a numeric port` };
    }
    http[name] = { subdomain: record.subdomain, local_port: localPort };
  }
  let backoff = { ...DEFAULT_BACKOFF };
  if (raw.backoff != null) {
    if (typeof raw.backoff !== 'object' || Array.isArray(raw.backoff)) {
      return { ok: false, reason: 'backoff is invalid' };
    }
    const given = raw.backoff as { min?: unknown; max?: unknown; factor?: unknown };
    const min = given.min == null ? DEFAULT_BACKOFF.min : given.min;
    const max = given.max == null ? DEFAULT_BACKOFF.max : given.max;
    const factor = given.factor == null ? DEFAULT_BACKOFF.factor : given.factor;
    if (![min, max, factor].every((item) => typeof item === 'number' && Number.isFinite(item))) {
      return { ok: false, reason: 'backoff is invalid' };
    }
    backoff = { min: min as number, max: max as number, factor: factor as number };
  }
  const settings: NormalizedClientSettings = {
    bind_port: bindPort,
    bind_host: raw.bind_host,
    timeout: finiteNumber(raw.timeout, DEFAULT_CLIENT_TIMEOUT),
    retry: finiteNumber(raw.retry, DEFAULT_CLIENT_RETRY),
    backoff,
    http,
  };
  if (typeof raw.subdomain_host === 'string') {
    settings.subdomain_host = raw.subdomain_host;
  }
  if (typeof raw.log_file === 'string') {
    settings.log_file = raw.log_file;
  }
  if (typeof raw.secret === 'string') {
    settings.secret = raw.secret;
  }
  if (typeof raw.ping_interval === 'number' && Number.isFinite(raw.ping_interval)) {
    settings.ping_interval = raw.ping_interval;
  }
  return { ok: true, settings };
}

export function authorizeClientSettings(
  input: unknown,
  serverSecret: string | undefined,
): SettingsResult {
  if (typeof serverSecret !== 'string' || serverSecret.length === 0) {
    return { ok: false, reason: 'server secret is not configured' };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'settings must be an object' };
  }
  const secret = (input as { secret?: unknown }).secret;
  if (typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, reason: 'missing secret' };
  }
  if (secret !== serverSecret) {
    return { ok: false, reason: 'wrong secret' };
  }
  return normalizeClientSettings(input);
}

export function resolveIdleTimeout(config: { idle_timeout?: number } | undefined): number {
  const value = config?.idle_timeout;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_IDLE_TIMEOUT;
}

export function reconnectDelay(
  attempt: number,
  backoff: { min: number; max: number; factor: number },
): number {
  const growth = backoff.min * Math.pow(backoff.factor, attempt - 1);
  return Math.min(backoff.max, growth);
}
