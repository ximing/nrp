import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import {
  DEFAULT_INIT_PROXIES,
  FormField,
  buildClientInitConfig,
  confirmOverwriteForm,
  createForm,
  createKeySource,
  enterScreen,
  leaveScreen,
  requireInteger,
  requirePositiveInteger,
  runForm,
  runProxyList,
} from '@nrpjs/shared';
import { writeConfigFile } from './config-file';

export interface InitCommandOptions {
  outputPath: string;
  input: Readable;
  stdout: Writable;
  tty?: boolean;
}

function panelVisible(values: Record<string, string>) {
  return values.panel === 'yes';
}

function clientForm(outputPath: string) {
  const fields: FormField[] = [
    { id: 'bind_host', label: '服务端地址', kind: 'text', value: '127.0.0.1', required: true },
    {
      id: 'bind_port',
      label: '服务端端口',
      kind: 'text',
      value: '9000',
      required: true,
      validate: requireInteger('服务端端口', 0, 65535),
    },
    { id: 'subdomain_host', label: '主机后缀', kind: 'text', value: 'example.com:9001', required: true },
    { id: 'secret', label: '共享密钥', kind: 'secret', value: '', required: true },
    { id: 'panel', label: '启用控制面板', kind: 'toggle', value: 'yes' },
    {
      id: 'dashboard_addr',
      label: '面板地址',
      kind: 'text',
      value: '127.0.0.1',
      required: true,
      visible: panelVisible,
    },
    {
      id: 'dashboard_port',
      label: '面板端口',
      kind: 'text',
      value: '7501',
      required: true,
      visible: panelVisible,
      validate: requireInteger('面板端口', 0, 65535),
    },
    {
      id: 'dashboard_user',
      label: '面板用户名',
      kind: 'text',
      value: 'admin',
      required: true,
      visible: panelVisible,
    },
    {
      id: 'dashboard_pwd',
      label: '面板密码',
      kind: 'secret',
      value: '',
      required: true,
      visible: panelVisible,
    },
    {
      id: 'timeout',
      label: '连接超时',
      kind: 'text',
      value: '10000',
      required: true,
      validate: requirePositiveInteger('连接超时'),
    },
    {
      id: 'retry',
      label: '重连次数',
      kind: 'text',
      value: '3',
      required: true,
      validate: requireInteger('重连次数', 0, 1000000),
    },
    {
      id: 'backoff_min',
      label: '退避最小',
      kind: 'text',
      value: '100',
      required: true,
      validate: requireInteger('退避最小', 0, 1000000000),
    },
    {
      id: 'backoff_max',
      label: '退避上限',
      kind: 'text',
      value: '1000',
      required: true,
      validate: requirePositiveInteger('退避上限'),
    },
    {
      id: 'backoff_factor',
      label: '退避倍数',
      kind: 'text',
      value: '2',
      required: true,
      validate: requirePositiveInteger('退避倍数'),
    },
    {
      id: 'ping_interval',
      label: '心跳间隔',
      kind: 'text',
      value: '10000',
      required: true,
      validate: requirePositiveInteger('心跳间隔'),
    },
    { id: 'config_path', label: '配置文件', kind: 'text', value: outputPath, required: true },
    { id: 'save', label: '保存', kind: 'action', value: '' },
  ];
  return createForm({
    title: '初始化客户端配置',
    help: '主机后缀要和访问时的 Host 一致。HTTP 端口不是 80 时写成 example.com:9001。',
    fields,
  });
}

function writeInitFile(filePath: string, config: unknown): { ok: true } | { ok: false; reason: string } {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    return { ok: false, reason: `目录不存在：${directory}` };
  }
  try {
    writeConfigFile(filePath, config);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : '写入失败';
    return { ok: false, reason: message };
  }
}

export async function runClientInit(options: InitCommandOptions): Promise<number> {
  const tty = options.tty === true;
  const keys = createKeySource(options.input);
  enterScreen(options.input, options.stdout, tty);
  let message = '已取消\n';
  let code = 1;
  try {
    const filled = await runForm({
      form: clientForm(path.resolve(options.outputPath)),
      keys,
      stdout: options.stdout,
      tty,
    });
    if (!filled || filled.action !== 'save') {
      return code;
    }
    const proxies = await runProxyList({
      items: DEFAULT_INIT_PROXIES,
      keys,
      stdout: options.stdout,
      tty,
    });
    if (!proxies) {
      return code;
    }
    const built = buildClientInitConfig({
      bind_host: filled.values.bind_host,
      bind_port: filled.values.bind_port,
      subdomain_host: filled.values.subdomain_host,
      secret: filled.values.secret,
      panel: filled.values.panel,
      dashboard_addr: filled.values.dashboard_addr,
      dashboard_port: filled.values.dashboard_port,
      dashboard_user: filled.values.dashboard_user,
      dashboard_pwd: filled.values.dashboard_pwd,
      timeout: filled.values.timeout,
      retry: filled.values.retry,
      backoff_min: filled.values.backoff_min,
      backoff_max: filled.values.backoff_max,
      backoff_factor: filled.values.backoff_factor,
      ping_interval: filled.values.ping_interval,
      proxies,
    });
    if (!built.ok) {
      message = `${built.reason}\n`;
      return code;
    }
    const filePath = path.resolve(filled.values.config_path);
    if (fs.existsSync(filePath)) {
      const confirm = await runForm({
        form: confirmOverwriteForm(filePath),
        keys,
        stdout: options.stdout,
        tty,
      });
      if (!confirm || confirm.action !== 'yes') {
        message = `未写入 ${filePath}\n`;
        return code;
      }
    }
    const written = writeInitFile(filePath, built.config);
    if (!written.ok) {
      message = `${written.reason}\n`;
      return code;
    }
    message = `已写入 ${filePath}\nnrpc -c ${filePath}\n`;
    code = 0;
    return code;
  } finally {
    leaveScreen(options.input, options.stdout, tty);
    options.stdout.write(message);
  }
}
