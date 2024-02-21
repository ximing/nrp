import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import {
  FormField,
  buildServerInitConfig,
  confirmOverwriteForm,
  createForm,
  createKeySource,
  enterScreen,
  leaveScreen,
  requireInteger,
  requirePositiveInteger,
  runForm,
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

function serverForm(outputPath: string) {
  const fields: FormField[] = [
    {
      id: 'port',
      label: '控制端口',
      kind: 'text',
      value: '9000',
      required: true,
      validate: requireInteger('控制端口', 0, 65535),
    },
    {
      id: 'vhost_http_port',
      label: 'HTTP 端口',
      kind: 'text',
      value: '9001',
      required: true,
      validate: requireInteger('HTTP 端口', 0, 65535),
    },
    { id: 'secret', label: '共享密钥', kind: 'secret', value: '', required: true },
    {
      id: 'idle_timeout',
      label: '空闲超时',
      kind: 'text',
      value: '60000',
      required: true,
      validate: requirePositiveInteger('空闲超时'),
    },
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
      value: '7500',
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
    { id: 'config_path', label: '配置文件', kind: 'text', value: outputPath, required: true },
    { id: 'save', label: '保存', kind: 'action', value: '' },
  ];
  return createForm({
    title: '初始化服务端配置',
    help: '控制端口给客户端连接，HTTP 端口给访问者。两边的共享密钥要相同。',
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

export async function runServerInit(options: InitCommandOptions): Promise<number> {
  const tty = options.tty === true;
  const keys = createKeySource(options.input);
  enterScreen(options.input, options.stdout, tty);
  let message = '已取消\n';
  let code = 1;
  try {
    const filled = await runForm({
      form: serverForm(path.resolve(options.outputPath)),
      keys,
      stdout: options.stdout,
      tty,
    });
    if (!filled || filled.action !== 'save') {
      return code;
    }
    const built = buildServerInitConfig({
      port: filled.values.port,
      vhost_http_port: filled.values.vhost_http_port,
      secret: filled.values.secret,
      idle_timeout: filled.values.idle_timeout,
      panel: filled.values.panel,
      dashboard_addr: filled.values.dashboard_addr,
      dashboard_port: filled.values.dashboard_port,
      dashboard_user: filled.values.dashboard_user,
      dashboard_pwd: filled.values.dashboard_pwd,
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
    message = `已写入 ${filePath}\nnrps -c ${filePath}\n`;
    code = 0;
    return code;
  } finally {
    leaveScreen(options.input, options.stdout, tty);
    options.stdout.write(message);
  }
}
