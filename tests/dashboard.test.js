const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServerFromConfigFile } = require('@nrpjs/server');
const { startClientFromConfigFile } = require('@nrpjs/client');

function basic(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers,
        timeout: 3000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${urlPath}`)));
    if (body != null) {
      req.write(body);
    }
    req.end();
  });
}

function writeServerFile(file) {
  fs.writeFileSync(
    file,
    [
      'port: 0',
      'vhost_http_port: 0',
      'secret: panel-secret',
      'idle_timeout: 80000',
      'dashboard_addr: 127.0.0.1',
      'dashboard_port: 0',
      'dashboard_user: admin',
      'dashboard_pwd: panel-pass',
      '',
    ].join('\n'),
  );
}

function writeClientFile(file, bindPort) {
  fs.writeFileSync(
    file,
    [
      'bind_host: 127.0.0.1',
      `bind_port: ${bindPort}`,
      'subdomain_host: example.test',
      'secret: panel-secret',
      'timeout: 10000',
      'retry: 0',
      'ping_interval: 60000',
      'dashboard_addr: 127.0.0.1',
      'dashboard_port: 0',
      'dashboard_user: operator',
      'dashboard_pwd: client-pass',
      'http:',
      '  web:',
      '    subdomain: app',
      '    local_port: 9',
      '',
    ].join('\n'),
  );
}

test('panel basic auth rejects missing and wrong credentials and persisted edits reload', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrp-panel-'));
  const serverFile = path.join(dir, 'nrps.yaml');
  const clientFile = path.join(dir, 'nrpc.yaml');
  writeServerFile(serverFile);
  let server;
  let client;
  t.after(async () => {
    if (client) {
      await client.stop();
    }
    if (server) {
      await server.close();
    }
  });
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const started = await startServerFromConfigFile(serverFile);
  server = started.server;
  assert.ok(started.address.dashboardPort > 0);
  assert.notEqual(started.address.dashboardPort, started.address.port);
  assert.notEqual(started.address.dashboardPort, started.address.vhostHttpPort);

  writeClientFile(clientFile, started.address.port);
  const clientStarted = await startClientFromConfigFile(clientFile);
  client = clientStarted.client;
  assert.ok(clientStarted.dashboardPort > 0);
  assert.notEqual(clientStarted.dashboardPort, started.address.port);
  assert.notEqual(clientStarted.dashboardPort, started.address.vhostHttpPort);

  const serverBefore = fs.readFileSync(serverFile, 'utf8');
  const clientBefore = fs.readFileSync(clientFile, 'utf8');
  const serverAuth = { authorization: basic('admin', 'panel-pass') };
  const clientAuth = { authorization: basic('operator', 'client-pass') };
  const json = { 'content-type': 'application/json' };

  for (const [port, file, before] of [
    [started.address.dashboardPort, serverFile, serverBefore],
    [clientStarted.dashboardPort, clientFile, clientBefore],
  ]) {
    const missing = await request(port, 'GET', '/api/config');
    assert.equal(missing.status, 401);
    assert.equal(missing.body.includes('panel-secret'), false);
    assert.equal(missing.body.includes('panel-pass'), false);
    assert.equal(missing.body.includes('client-pass'), false);
    const page = await request(port, 'GET', '/');
    assert.equal(page.status, 401);
    const wrong = await request(port, 'PUT', '/api/config', {
      headers: { ...json, authorization: basic('admin', 'nope') },
      body: JSON.stringify({ idle_timeout: 11111, timeout: 11111 }),
    });
    assert.equal(wrong.status, 401);
    const wrongProxy = await request(port, 'POST', '/api/proxies', {
      headers: { ...json, authorization: basic('operator', 'nope') },
      body: JSON.stringify({ name: 'sneak', subdomain: 'sneak', local_port: 1 }),
    });
    assert.equal(wrongProxy.status, 401);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }

  const serverPut = await request(started.address.dashboardPort, 'PUT', '/api/config', {
    headers: { ...json, ...serverAuth },
    body: JSON.stringify({ idle_timeout: 42420 }),
  });
  assert.equal(serverPut.status, 200);
  const serverText = fs.readFileSync(serverFile, 'utf8');
  assert.equal(serverText.includes('42420'), true);
  assert.equal(serverText.includes('panel-secret'), true);
  assert.equal(serverText.includes('11111'), false);

  const clientPut = await request(clientStarted.dashboardPort, 'PUT', '/api/config', {
    headers: { ...json, ...clientAuth },
    body: JSON.stringify({ timeout: 2222 }),
  });
  assert.equal(clientPut.status, 200);
  const proxyPut = await request(clientStarted.dashboardPort, 'POST', '/api/proxies', {
    headers: { ...json, ...clientAuth },
    body: JSON.stringify({ name: 'added', subdomain: 'from-panel', local_port: 4010 }),
  });
  assert.equal(proxyPut.status, 200);
  const clientText = fs.readFileSync(clientFile, 'utf8');
  assert.equal(clientText.includes('2222'), true);
  assert.equal(clientText.includes('from-panel'), true);
  assert.equal(clientText.includes('4010'), true);
  assert.equal(clientText.includes('panel-secret'), true);
  assert.equal(clientText.includes('11111'), false);
  assert.equal(clientText.includes('sneak'), false);

  await client.stop();
  client = null;
  await server.close();
  server = null;

  const restarted = await startServerFromConfigFile(serverFile);
  server = restarted.server;
  const serverAgain = await request(restarted.address.dashboardPort, 'GET', '/api/config', {
    headers: serverAuth,
  });
  assert.equal(serverAgain.status, 200);
  const serverConfig = JSON.parse(serverAgain.body);
  assert.equal(serverConfig.idle_timeout, 42420);
  assert.equal(serverConfig.secret, 'panel-secret');

  const clientAgain = await startClientFromConfigFile(clientFile);
  client = clientAgain.client;
  const clientBody = await request(clientAgain.dashboardPort, 'GET', '/api/config', {
    headers: clientAuth,
  });
  assert.equal(clientBody.status, 200);
  const clientConfig = JSON.parse(clientBody.body);
  assert.equal(clientConfig.timeout, 2222);
  assert.equal(clientConfig.http.added.subdomain, 'from-panel');
  assert.equal(clientConfig.http.added.local_port, 4010);
  assert.equal(clientConfig.http.web.subdomain, 'app');
  assert.equal(clientConfig.secret, 'panel-secret');
});
