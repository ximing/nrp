const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const { parse } = require('../packages/server/node_modules/yaml');
const {
  createForm,
  reduceForm,
  renderForm,
  pushKeys,
  createKeySource,
  requireInteger,
  createProxyList,
  reduceProxyList,
  buildServerInitConfig,
  buildClientInitConfig,
  normalizeClientSettings,
} = require('@nrpjs/shared');
const { runServerInit } = require('@nrpjs/server');
const { runClientInit } = require('@nrpjs/client');

const down = '\x1b[B';
const enter = '\r';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nrp-init-'));

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function serverKeys() {
  return `${down}${down}${enter}s3cret${enter}${down.repeat(6)}${enter}panel-pass${enter}${down}${down}${enter}`;
}

function clientKeys(extra = '') {
  return `${down.repeat(3)}${enter}s3cret${enter}${down.repeat(5)}${enter}panel-pass${enter}${down.repeat(8)}${enter}${extra}`;
}

function runWithKeys(run, outputPath, keys) {
  const input = new PassThrough();
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const pending = run({ outputPath, input, stdout, tty: false });
  input.write(keys);
  input.end();
  return pending.then((code) => ({
    code,
    text: Buffer.concat(chunks).toString('utf8'),
  }));
}

test('form moves, edits, and keeps an invalid port open', () => {
  let state = createForm({
    title: 't',
    fields: [
      {
        id: 'port',
        label: '控制端口',
        kind: 'text',
        value: '9000',
        validate: requireInteger('控制端口', 0, 65535),
      },
      { id: 'secret', label: '共享密钥', kind: 'secret', value: '', required: true },
    ],
  });
  state = reduceForm(state, { type: 'down' });
  assert.match(renderForm(state), /> 共享密钥/);
  state = reduceForm(state, { type: 'up' });
  state = reduceForm(state, { type: 'enter' });
  assert.equal(state.editing, true);
  for (let index = 0; index < 4; index += 1) {
    state = reduceForm(state, { type: 'backspace' });
  }
  for (const ch of '70000') {
    state = reduceForm(state, { type: 'char', value: ch });
  }
  state = reduceForm(state, { type: 'enter' });
  assert.equal(state.editing, true);
  assert.match(state.error, /控制端口/);
  assert.equal(state.fields[0].value, '9000');
});

test('turning the panel off hides dashboard fields', () => {
  const panelOn = (values) => values.panel === 'yes';
  let state = createForm({
    title: 't',
    fields: [
      { id: 'panel', label: '启用控制面板', kind: 'toggle', value: 'yes' },
      {
        id: 'dashboard_port',
        label: '面板端口',
        kind: 'text',
        value: '7500',
        visible: panelOn,
      },
      { id: 'save', label: '保存', kind: 'action', value: '' },
    ],
  });
  assert.match(renderForm(state), /面板端口/);
  state = reduceForm(state, { type: 'enter' });
  assert.equal(state.fields[0].value, 'no');
  assert.doesNotMatch(renderForm(state), /面板端口/);
  state = reduceForm(state, { type: 'down' });
  assert.match(renderForm(state), /> 保存/);
});

test('saving with an empty secret focuses that field', () => {
  let state = createForm({
    title: 't',
    fields: [
      { id: 'port', label: '控制端口', kind: 'text', value: '9000' },
      { id: 'secret', label: '共享密钥', kind: 'secret', value: '', required: true },
      { id: 'save', label: '保存', kind: 'action', value: '' },
    ],
  });
  state = reduceForm(state, { type: 'down' });
  state = reduceForm(state, { type: 'down' });
  state = reduceForm(state, { type: 'enter' });
  assert.equal(state.done, false);
  assert.equal(state.cursor, 1);
  assert.match(state.error, /共享密钥/);
  assert.match(renderForm(state), /> 共享密钥/);
});

test('escape cancels the form and abandons an edit first', () => {
  let state = createForm({
    title: 't',
    fields: [{ id: 'secret', label: '共享密钥', kind: 'secret', value: 'keep', required: true }],
  });
  state = reduceForm(state, { type: 'enter' });
  state = reduceForm(state, { type: 'backspace' });
  state = reduceForm(state, { type: 'escape' });
  assert.equal(state.editing, false);
  assert.equal(state.cancelled, false);
  assert.equal(state.fields[0].value, 'keep');
  state = reduceForm(state, { type: 'escape' });
  assert.equal(state.cancelled, true);
});

test('pushKeys keeps a split escape sequence for the next chunk', () => {
  const split = pushKeys('', '\x1b');
  assert.deepEqual(split.keys, []);
  assert.equal(split.rest, '\x1b');
  const downKey = pushKeys(split.rest, '[B');
  assert.equal(downKey.keys[0].type, 'down');
  assert.equal(downKey.rest, '');
  const flushed = pushKeys('', '\x1b', true);
  assert.equal(flushed.keys[0].type, 'escape');
});

test('key source reassembles an arrow written in two chunks', async () => {
  const input = new PassThrough();
  const keys = createKeySource(input);
  const pending = keys.next();
  input.write('\x1b');
  input.write('[A');
  const key = await pending;
  assert.equal(key && key.type, 'up');
  input.end();
});

test('an empty proxy list stays open', () => {
  let state = createProxyList([]);
  state = reduceProxyList(state, { type: 'down' });
  state = reduceProxyList(state, { type: 'enter' });
  assert.equal(state.done, false);
  assert.equal(state.error, '至少添加一个 HTTP 代理');
});

test('server config omits the panel when it is off and rejects a bad port', () => {
  const off = buildServerInitConfig({
    port: '9000',
    vhost_http_port: '9001',
    secret: 's3cret',
    idle_timeout: '60000',
    panel: 'no',
    dashboard_addr: '127.0.0.1',
    dashboard_port: '7500',
    dashboard_user: 'admin',
    dashboard_pwd: 'panel-pass',
  });
  assert.equal(off.ok, true);
  assert.equal(off.config.secret, 's3cret');
  assert.equal(off.config.port, 9000);
  assert.equal(Object.prototype.hasOwnProperty.call(off.config, 'dashboard_port'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(off.config, 'dashboard_pwd'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(off.config, 'dashboard_user'), false);

  const bad = buildServerInitConfig({
    port: '70000',
    vhost_http_port: '9001',
    secret: 's3cret',
    idle_timeout: '60000',
    panel: 'no',
  });
  assert.equal(bad.ok, false);

  const empty = buildServerInitConfig({
    port: '9000',
    vhost_http_port: '9001',
    secret: '',
    idle_timeout: '60000',
    panel: 'no',
  });
  assert.equal(empty.ok, false);
});

test('client config keeps proxies and dashboard fields that normalization drops', () => {
  const built = buildClientInitConfig({
    bind_host: '127.0.0.1',
    bind_port: '9000',
    subdomain_host: 'example.com:9001',
    secret: 's3cret',
    panel: 'yes',
    dashboard_addr: '127.0.0.1',
    dashboard_port: '7501',
    dashboard_user: 'admin',
    dashboard_pwd: 'panel-pass',
    timeout: '10000',
    retry: '3',
    backoff_min: '100',
    backoff_max: '1000',
    backoff_factor: '2',
    ping_interval: '10000',
    proxies: [{ name: 'web', subdomain: 'app', local_port: '3000' }],
  });
  assert.equal(built.ok, true);
  assert.equal(built.config.http.web.subdomain, 'app');
  assert.equal(built.config.http.web.local_port, 3000);
  assert.equal(built.config.dashboard_pwd, 'panel-pass');
  assert.equal(built.config.dashboard_port, 7501);
  const normalized = normalizeClientSettings(built.config);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.settings.http.web.local_port, 3000);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings, 'dashboard_pwd'), false);

  const off = buildClientInitConfig({
    bind_host: '127.0.0.1',
    bind_port: '9000',
    subdomain_host: 'example.com:9001',
    secret: 's3cret',
    panel: 'no',
    dashboard_pwd: 'panel-pass',
    timeout: '10000',
    retry: '3',
    backoff_min: '100',
    backoff_max: '1000',
    backoff_factor: '2',
    ping_interval: '10000',
    proxies: [{ name: 'web', subdomain: 'app', local_port: '3000' }],
  });
  assert.equal(off.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(off.config, 'dashboard_pwd'), false);
});

test('scripted server init writes the answers', async () => {
  const file = path.join(root, 'nrps.yaml');
  const { code, text } = await runWithKeys(runServerInit, file, serverKeys());
  assert.equal(code, 0);
  assert.match(text, /> 共享密钥/);
  assert.match(text, /已写入/);
  const parsed = parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.secret, 's3cret');
  assert.equal(parsed.port, 9000);
  assert.equal(parsed.vhost_http_port, 9001);
  assert.equal(parsed.idle_timeout, 60000);
  assert.equal(parsed.dashboard_addr, '127.0.0.1');
  assert.equal(parsed.dashboard_port, 7500);
  assert.equal(parsed.dashboard_user, 'admin');
  assert.equal(parsed.dashboard_pwd, 'panel-pass');
});

test('declining overwrite leaves the file bytes unchanged', async () => {
  const file = path.join(root, 'keep-nrps.yaml');
  fs.writeFileSync(file, 'KEEP-ME');
  const before = fs.readFileSync(file);
  const { code, text } = await runWithKeys(runServerInit, file, `${serverKeys()}${enter}`);
  assert.equal(code, 1);
  assert.match(text, /未写入/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('accepting overwrite replaces the file', async () => {
  const file = path.join(root, 'replace-nrps.yaml');
  fs.writeFileSync(file, 'OLD');
  const { code } = await runWithKeys(runServerInit, file, `${serverKeys()}\x1b[C${enter}`);
  assert.equal(code, 0);
  const parsed = parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.secret, 's3cret');
  assert.equal(parsed.dashboard_pwd, 'panel-pass');
});

test('a missing parent directory is reported without throwing', async () => {
  const file = path.join(root, 'missing-dir', 'nrps.yaml');
  const { code, text } = await runWithKeys(runServerInit, file, serverKeys());
  assert.equal(code, 1);
  assert.match(text, /目录不存在/);
  assert.equal(fs.existsSync(file), false);
});

test('scripted client init writes the seeded proxy', async () => {
  const file = path.join(root, 'nrpc.yaml');
  const { code, text } = await runWithKeys(runClientInit, file, clientKeys(`${down}${down}${enter}`));
  assert.equal(code, 0, text);
  assert.match(text, /web {2}app → 3000/);
  assert.match(text, /已写入/);
  const parsed = parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.secret, 's3cret');
  assert.equal(parsed.bind_host, '127.0.0.1');
  assert.equal(parsed.bind_port, 9000);
  assert.equal(parsed.subdomain_host, 'example.com:9001');
  assert.equal(parsed.http.web.subdomain, 'app');
  assert.equal(parsed.http.web.local_port, 3000);
  assert.equal(parsed.dashboard_port, 7501);
  assert.equal(parsed.dashboard_pwd, 'panel-pass');
  assert.equal(parsed.timeout, 10000);
  assert.equal(parsed.retry, 3);
  assert.deepEqual(parsed.backoff, { min: 100, max: 1000, factor: 2 });
  assert.equal(parsed.ping_interval, 10000);
});

test('client init refuses to finish with no proxies', async () => {
  const file = path.join(root, 'empty-nrpc.yaml');
  const { code, text } = await runWithKeys(runClientInit, file, clientKeys(`x${down}${enter}`));
  assert.equal(code, 1);
  assert.match(text, /至少添加一个 HTTP 代理/);
  assert.equal(fs.existsSync(file), false);
});

function runBin(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PINO_LOG_LEVEL: 'silent' },
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    child.stdin.end();
  });
}

test('server and client help mention init', async () => {
  const serverBin = path.join(__dirname, '../packages/server/dist/bin.js');
  const clientBin = path.join(__dirname, '../packages/client/dist/bin.js');
  const serverHelp = await runBin(serverBin, ['--help']);
  const serverInitHelp = await runBin(serverBin, ['init', '--help']);
  const clientHelp = await runBin(clientBin, ['--help']);
  const clientInitHelp = await runBin(clientBin, ['init', '--help']);
  assert.equal(serverHelp.code, 0, serverHelp.stderr);
  assert.match(`${serverHelp.stdout}${serverHelp.stderr}`, /init/);
  assert.equal(serverInitHelp.code, 0, serverInitHelp.stderr);
  assert.match(`${serverInitHelp.stdout}${serverInitHelp.stderr}`, /init/);
  assert.match(`${serverInitHelp.stdout}${serverInitHelp.stderr}`, /nrps\.yaml/);
  assert.equal(clientHelp.code, 0, clientHelp.stderr);
  assert.match(`${clientHelp.stdout}${clientHelp.stderr}`, /init/);
  assert.equal(clientInitHelp.code, 0, clientInitHelp.stderr);
  assert.match(`${clientInitHelp.stdout}${clientInitHelp.stderr}`, /nrpc\.yaml/);
});

test('init without a terminal exits and does not create a file', async () => {
  const serverBin = path.join(__dirname, '../packages/server/dist/bin.js');
  const clientBin = path.join(__dirname, '../packages/client/dist/bin.js');
  const serverFile = path.join(root, 'no-tty-nrps.yaml');
  const clientFile = path.join(root, 'no-tty-nrpc.yaml');
  const server = await runBin(serverBin, ['init', '-o', serverFile]);
  const client = await runBin(clientBin, ['init', '-o', clientFile]);
  assert.equal(server.code, 1, `${server.stdout}\n${server.stderr}`);
  assert.match(`${server.stdout}${server.stderr}`, /终端/);
  assert.equal(fs.existsSync(serverFile), false);
  assert.equal(client.code, 1, `${client.stdout}\n${client.stderr}`);
  assert.match(`${client.stdout}${client.stderr}`, /终端/);
  assert.equal(fs.existsSync(clientFile), false);
});
