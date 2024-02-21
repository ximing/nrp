import { Writable } from 'stream';
import { createForm, FormField, Key, KeySource, paintFrame, requireInteger, runForm } from './tui-form';

export interface ProxyItem {
  name: string;
  subdomain: string;
  local_port: string;
}

export interface ProxyListState {
  items: ProxyItem[];
  cursor: number;
  error: string;
  done: boolean;
  cancelled: boolean;
  pending: 'edit' | 'add' | null;
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function createProxyList(items: ProxyItem[]): ProxyListState {
  return {
    items: items.map((item) => ({ ...item })),
    cursor: 0,
    error: '',
    done: false,
    cancelled: false,
    pending: null,
  };
}

function rowCount(state: ProxyListState): number {
  return state.items.length + 2;
}

export function reduceProxyList(state: ProxyListState, key: Key): ProxyListState {
  if (state.done || state.cancelled || state.pending) {
    return state;
  }
  const rows = rowCount(state);
  const cursor = Math.min(Math.max(state.cursor, 0), rows - 1);
  if (key.type === 'escape') {
    return { ...state, cursor, cancelled: true };
  }
  if (key.type === 'up' || key.type === 'left') {
    return { ...state, cursor: Math.max(0, cursor - 1), error: '' };
  }
  if (key.type === 'down' || key.type === 'right') {
    return { ...state, cursor: Math.min(rows - 1, cursor + 1), error: '' };
  }
  if (key.type === 'char' && (key.value === 'x' || key.value === 'X')) {
    if (cursor >= state.items.length) {
      return { ...state, cursor };
    }
    const items = state.items.filter((_, index) => index !== cursor);
    return { ...state, items, cursor: Math.min(cursor, items.length + 1), error: '' };
  }
  if (key.type === 'enter') {
    if (cursor < state.items.length) {
      return { ...state, cursor, pending: 'edit', error: '' };
    }
    if (cursor === state.items.length) {
      return { ...state, cursor, pending: 'add', error: '' };
    }
    if (state.items.length === 0) {
      return { ...state, cursor, error: '至少添加一个 HTTP 代理' };
    }
    return { ...state, cursor, done: true, error: '' };
  }
  return { ...state, cursor };
}

export function renderProxyList(state: ProxyListState): string {
  const lines = ['HTTP 代理', '', '回车编辑，x 删除。至少保留一条。', ''];
  state.items.forEach((item, index) => {
    const marker = index === state.cursor ? '>' : ' ';
    lines.push(`${marker} ${item.name}  ${item.subdomain} → ${item.local_port}`);
  });
  const addAt = state.items.length;
  const doneAt = state.items.length + 1;
  lines.push(`${state.cursor === addAt ? '>' : ' '} 添加代理`);
  lines.push(`${state.cursor === doneAt ? '>' : ' '} 完成并写入`);
  if (state.error) {
    lines.push('', state.error);
  }
  lines.push('', '↑↓ 移动   Enter 确认   x 删除   Esc 取消');
  return lines.join('\n');
}

export function proxyForm(item: ProxyItem, otherNames: string[]) {
  const fields: FormField[] = [
    {
      id: 'name',
      label: '名称',
      kind: 'text',
      value: item.name,
      required: true,
      validate: (value) => {
        if (!NAME_PATTERN.test(value)) {
          return '名称要以字母开头，只能包含字母、数字、_ 和 -';
        }
        if (otherNames.includes(value)) {
          return '名称已存在';
        }
        return null;
      },
    },
    {
      id: 'subdomain',
      label: '子域名',
      kind: 'text',
      value: item.subdomain,
      required: true,
      validate: (value) => (/\s/.test(value) ? '子域名不能包含空格' : null),
    },
    {
      id: 'local_port',
      label: '本机端口',
      kind: 'text',
      value: item.local_port,
      required: true,
      validate: requireInteger('本机端口', 0, 65535),
    },
    { id: 'save', label: '保存', kind: 'action', value: '' },
  ];
  return createForm({
    title: item.name ? '编辑代理' : '添加代理',
    help: '名称会写成配置里的键。',
    fields,
  });
}

export const DEFAULT_INIT_PROXIES: ProxyItem[] = [
  { name: 'web', subdomain: 'app', local_port: '3000' },
];

export async function runProxyList(options: {
  items: ProxyItem[];
  keys: KeySource;
  stdout: Writable;
  tty?: boolean;
}): Promise<ProxyItem[] | null> {
  let state = createProxyList(options.items);
  const tty = options.tty === true;
  while (!state.done && !state.cancelled) {
    if (state.pending) {
      const pending = state.pending;
      const index = state.cursor;
      state = { ...state, pending: null, error: '' };
      const existing = pending === 'edit' ? state.items[index] : undefined;
      if (pending === 'edit' && !existing) {
        continue;
      }
      const current = existing ?? { name: '', subdomain: '', local_port: '' };
      const others = state.items
        .filter((_, itemIndex) => pending !== 'edit' || itemIndex !== index)
        .map((item) => item.name);
      const result = await runForm({
        form: proxyForm(current, others),
        keys: options.keys,
        stdout: options.stdout,
        tty,
      });
      if (result && result.action === 'save') {
        const item = {
          name: result.values.name,
          subdomain: result.values.subdomain,
          local_port: result.values.local_port,
        };
        const items = state.items.slice();
        if (pending === 'edit') {
          items[index] = item;
        } else {
          items.push(item);
        }
        state = {
          ...state,
          items,
          cursor: pending === 'edit' ? index : items.length - 1,
          error: '',
        };
      }
      continue;
    }
    paintFrame(options.stdout, renderProxyList(state), tty);
    const key = await options.keys.next();
    if (key == null) {
      state = { ...state, cancelled: true };
      break;
    }
    state = reduceProxyList(state, key);
  }
  if (state.cancelled || !state.done) {
    return null;
  }
  return state.items;
}
