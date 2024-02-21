import { Readable, Writable } from 'stream';

export type FieldKind = 'text' | 'secret' | 'toggle' | 'action';

export interface FormField {
  id: string;
  label: string;
  kind: FieldKind;
  value: string;
  required?: boolean;
  visible?: (values: Record<string, string>) => boolean;
  validate?: (value: string, values: Record<string, string>) => string | null;
}

export interface FormState {
  title: string;
  help: string;
  fields: FormField[];
  cursor: number;
  editing: boolean;
  draft: string;
  error: string;
  done: boolean;
  cancelled: boolean;
  action: string;
}

export type Key =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'enter' }
  | { type: 'escape' }
  | { type: 'backspace' }
  | { type: 'char'; value: string };

export interface FormResult {
  action: string;
  values: Record<string, string>;
}

type TerminalInput = Readable & {
  setRawMode?: (enabled: boolean) => void;
};

const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
};

export function requireInteger(label: string, min: number, max: number) {
  return (value: string): string | null => {
    if (!/^[0-9]+$/.test(value)) {
      return `${label}需要是 ${min} 到 ${max} 的整数`;
    }
    const parsed = Number(value);
    if (parsed < min || parsed > max) {
      return `${label}需要是 ${min} 到 ${max} 的整数`;
    }
    return null;
  };
}

export function requirePositiveInteger(label: string) {
  return (value: string): string | null => {
    if (!/^[0-9]+$/.test(value) || Number(value) <= 0) {
      return `${label}需要是大于 0 的整数`;
    }
    return null;
  };
}

export function createForm(spec: {
  title: string;
  help?: string;
  fields: FormField[];
  cursor?: number;
}): FormState {
  return {
    title: spec.title,
    help: spec.help ?? '',
    fields: spec.fields.map((field) => ({ ...field })),
    cursor: spec.cursor ?? 0,
    editing: false,
    draft: '',
    error: '',
    done: false,
    cancelled: false,
    action: '',
  };
}

export function formValues(state: FormState): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of state.fields) {
    if (field.kind === 'action') {
      continue;
    }
    values[field.id] = field.value;
  }
  return values;
}

export function visibleFields(state: FormState): FormField[] {
  const values = formValues(state);
  return state.fields.filter((field) => (field.visible ? field.visible(values) : true));
}

function fieldError(field: FormField, value: string, values: Record<string, string>): string | null {
  if (field.kind === 'action' || field.kind === 'toggle') {
    return null;
  }
  if (field.required && value.length === 0) {
    return `请填写${field.label}`;
  }
  if (field.validate) {
    return field.validate(value, values);
  }
  return null;
}

function replaceField(state: FormState, id: string, value: string): FormField[] {
  return state.fields.map((field) => (field.id === id ? { ...field, value } : field));
}

function firstInvalid(state: FormState): { index: number; message: string } | null {
  const values = formValues(state);
  const visible = visibleFields(state);
  for (let index = 0; index < visible.length; index += 1) {
    const field = visible[index];
    const message = fieldError(field, field.value, values);
    if (message) {
      return { index, message };
    }
  }
  return null;
}

export function reduceForm(state: FormState, key: Key): FormState {
  if (state.done || state.cancelled) {
    return state;
  }
  const visible = visibleFields(state);
  if (visible.length === 0) {
    return state;
  }
  const cursor = Math.min(Math.max(state.cursor, 0), visible.length - 1);
  const current = visible[cursor];

  if (state.editing) {
    if (key.type === 'escape') {
      return { ...state, cursor, editing: false, draft: '', error: '' };
    }
    if (key.type === 'backspace') {
      return { ...state, cursor, draft: state.draft.slice(0, -1), error: '' };
    }
    if (key.type === 'char') {
      return { ...state, cursor, draft: state.draft + key.value, error: '' };
    }
    if (key.type === 'enter') {
      const message = fieldError(current, state.draft, formValues(state));
      if (message) {
        return { ...state, cursor, error: message };
      }
      return {
        ...state,
        cursor,
        fields: replaceField(state, current.id, state.draft),
        editing: false,
        draft: '',
        error: '',
      };
    }
    return { ...state, cursor };
  }

  if (key.type === 'escape') {
    return { ...state, cursor, cancelled: true };
  }
  if (key.type === 'up' || key.type === 'left') {
    return { ...state, cursor: Math.max(0, cursor - 1), error: '' };
  }
  if (key.type === 'down' || key.type === 'right') {
    return { ...state, cursor: Math.min(visible.length - 1, cursor + 1), error: '' };
  }
  if (key.type === 'enter') {
    if (current.kind === 'toggle') {
      const next = current.value === 'yes' ? 'no' : 'yes';
      const fields = replaceField(state, current.id, next);
      const nextState = { ...state, fields, error: '' };
      const nextVisible = visibleFields(nextState);
      return {
        ...nextState,
        cursor: Math.min(cursor, Math.max(nextVisible.length - 1, 0)),
      };
    }
    if (current.kind === 'action') {
      if (current.id === 'save') {
        const invalid = firstInvalid(state);
        if (invalid) {
          return { ...state, cursor: invalid.index, error: invalid.message };
        }
      }
      return { ...state, cursor, done: true, action: current.id, error: '' };
    }
    return { ...state, cursor, editing: true, draft: current.value, error: '' };
  }
  return { ...state, cursor };
}

function shownValue(field: FormField, editing: boolean, draft: string): string {
  if (field.kind === 'action') {
    return field.label;
  }
  if (field.kind === 'toggle') {
    return `${field.label}  ${field.value === 'yes' ? '是' : '否'}`;
  }
  if (editing) {
    const text = field.kind === 'secret' ? '•'.repeat(draft.length) : draft;
    return `${field.label}  [${text}]`;
  }
  if (field.kind === 'secret') {
    return `${field.label}  ${'•'.repeat(field.value.length)}`;
  }
  return `${field.label}  ${field.value}`;
}

export function renderForm(state: FormState): string {
  const lines = [state.title, ''];
  if (state.help) {
    lines.push(state.help, '');
  }
  const visible = visibleFields(state);
  visible.forEach((field, index) => {
    const marker = index === state.cursor ? '>' : ' ';
    const editing = state.editing && index === state.cursor;
    lines.push(`${marker} ${shownValue(field, editing, state.draft)}`);
  });
  if (state.error) {
    lines.push('', state.error);
  }
  lines.push('', '↑↓ 移动   Enter 确认   Esc 取消');
  return lines.join('\n');
}

export function pushKeys(
  buffer: string,
  chunk: string,
  flush = false,
): { keys: Key[]; rest: string } {
  const input = buffer + chunk;
  const keys: Key[] = [];
  let index = 0;
  while (index < input.length) {
    const ch = input[index];
    if (ch === '\u001b') {
      const next = input[index + 1];
      if (next == null) {
        if (flush) {
          keys.push({ type: 'escape' });
          index += 1;
          continue;
        }
        return { keys, rest: input.slice(index) };
      }
      if (next === '[') {
        const code = input[index + 2];
        if (code == null) {
          if (flush) {
            keys.push({ type: 'escape' });
            index += 2;
            continue;
          }
          return { keys, rest: input.slice(index) };
        }
        const arrow = ARROWS[code];
        if (arrow) {
          keys.push({ type: arrow });
          index += 3;
          continue;
        }
      }
      keys.push({ type: 'escape' });
      index += 1;
      continue;
    }
    if (ch === '\r') {
      keys.push({ type: 'enter' });
      index += input[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      keys.push({ type: 'enter' });
      index += 1;
      continue;
    }
    if (ch === '\u007f' || ch === '\b') {
      keys.push({ type: 'backspace' });
      index += 1;
      continue;
    }
    if (ch < ' ') {
      index += 1;
      continue;
    }
    keys.push({ type: 'char', value: ch });
    index += 1;
  }
  return { keys, rest: '' };
}

export interface KeySource {
  next(): Promise<Key | null>;
}

export function createKeySource(input: Readable): KeySource {
  let pending = '';
  const queue: Key[] = [];
  let ended = false;
  let waiter: ((key: Key | null) => void) | null = null;
  let timer: NodeJS.Timeout | null = null;

  const deliver = () => {
    if (!waiter) {
      return;
    }
    if (queue.length > 0) {
      const key = queue.shift() as Key;
      const resolve = waiter;
      waiter = null;
      resolve(key);
      return;
    }
    if (ended && pending.length === 0) {
      const resolve = waiter;
      waiter = null;
      resolve(null);
    }
  };

  const ingest = (text: string, flush: boolean) => {
    const decoded = pushKeys(pending, text, flush);
    pending = decoded.rest;
    queue.push(...decoded.keys);
    deliver();
  };

  input.on('data', (chunk: Buffer | string) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    ingest(text, false);
    if (pending.length > 0) {
      timer = setTimeout(() => {
        timer = null;
        ingest('', true);
      }, 40);
      timer.unref();
    }
  });
  input.on('end', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    ended = true;
    ingest('', true);
  });

  return {
    next() {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift() as Key);
      }
      if (ended && pending.length === 0) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
  };
}

export function paintFrame(stdout: Writable, frame: string, tty: boolean) {
  if (tty) {
    stdout.write(`\u001b[H\u001b[2J${frame}`);
    return;
  }
  stdout.write(`${frame}\n`);
}

export function enterScreen(input: TerminalInput, stdout: Writable, tty: boolean) {
  if (!tty) {
    return;
  }
  stdout.write('\u001b[?1049h');
  if (typeof input.setRawMode === 'function') {
    input.setRawMode(true);
  }
}

export function leaveScreen(input: TerminalInput, stdout: Writable, tty: boolean) {
  if (!tty) {
    return;
  }
  if (typeof input.setRawMode === 'function') {
    input.setRawMode(false);
  }
  stdout.write('\u001b[?1049l');
}

export function confirmOverwriteForm(filePath: string): FormState {
  return createForm({
    title: '文件已存在',
    help: `覆盖 ${filePath}？`,
    fields: [
      { id: 'no', label: '否', kind: 'action', value: '' },
      { id: 'yes', label: '是', kind: 'action', value: '' },
    ],
  });
}

export async function runForm(options: {
  form: FormState;
  keys: KeySource;
  stdout: Writable;
  tty?: boolean;
}): Promise<FormResult | null> {
  let state = options.form;
  const tty = options.tty === true;
  while (!state.done && !state.cancelled) {
    paintFrame(options.stdout, renderForm(state), tty);
    const key = await options.keys.next();
    if (key == null) {
      state = { ...state, cancelled: true };
      break;
    }
    state = reduceForm(state, key);
  }
  if (state.cancelled || !state.done) {
    return null;
  }
  return { action: state.action, values: formValues(state) };
}
