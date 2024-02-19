const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');

const { NrpClient } = require('@nrpjs/client');
const {
  DEFAULT_BACKOFF,
  Frame,
  FrameFlag,
  FrameReassembler,
  FrameType,
  MAX_STREAM_ID,
  allocateStreamId,
  reconnectDelay,
  resolveIdleTimeout,
} = require('@nrpjs/shared');
const {
  UPSTREAM_BODY,
  delay,
  httpRequest,
  listen,
  openControl,
  settingsFrame,
  startNrp,
  startUpstream,
  waitFor,
} = require('./helpers');

function clientSettings(extra) {
  return {
    bind_host: '127.0.0.1',
    subdomain_host: 'example.test',
    secret: 'test-secret',
    http: { app: { subdomain: 'app', local_port: 9 } },
    ...extra,
  };
}

async function closedPort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

test('reconnect delay is min * factor^(n-1), capped by max', () => {
  const backoff = { min: 100, max: 1000, factor: 2 };
  assert.equal(reconnectDelay(1, backoff), 100);
  assert.equal(reconnectDelay(2, backoff), 200);
  assert.equal(reconnectDelay(3, backoff), 400);
  assert.equal(reconnectDelay(4, backoff), 800);
  assert.equal(reconnectDelay(5, backoff), 1000);
  assert.equal(reconnectDelay(8, backoff), 1000);
  assert.equal(reconnectDelay(1, DEFAULT_BACKOFF), DEFAULT_BACKOFF.min);
});

test('a refused connect backs off and stops after retry', async () => {
  const port = await closedPort();
  const client = new NrpClient(
    clientSettings({
      bind_port: port,
      timeout: 200,
      retry: 3,
      ping_interval: 50,
      backoff: { min: 80, max: 250, factor: 2 },
    }),
  );
  client.start();
  try {
    await waitFor(() => client.connectAttemptAt.length >= 4, 2500);
    assert.equal(client.connectAttemptAt.length, 4);
    const gaps = [];
    for (let index = 1; index < client.connectAttemptAt.length; index += 1) {
      gaps.push(client.connectAttemptAt[index] - client.connectAttemptAt[index - 1]);
    }
    assert.ok(gaps[0] >= 70 && gaps[0] < 150, `first delay ${gaps[0]}`);
    assert.ok(gaps[1] >= 140 && gaps[1] < 240, `second delay ${gaps[1]}`);
    assert.ok(gaps[2] >= 220 && gaps[2] < 450, `third delay ${gaps[2]}`);
    await delay(400);
    assert.equal(client.connectAttemptAt.length, 4);
    assert.equal(client.hasHeartbeat(), false);
  } finally {
    client.stop();
  }
});

test('omitted backoff uses the default delay and stops', async () => {
  const port = await closedPort();
  const client = new NrpClient(
    clientSettings({
      bind_port: port,
      timeout: 300,
      retry: 1,
    }),
  );
  client.start();
  try {
    await waitFor(() => client.connectAttemptAt.length >= 2, 2000);
    const gap = client.connectAttemptAt[1] - client.connectAttemptAt[0];
    assert.ok(gap >= 80 && gap < 250, `default delay ${gap}`);
    await delay(300);
    assert.equal(client.connectAttemptAt.length, 2);
  } finally {
    client.stop();
  }
});

test('timeout bounds a connect attempt that does not complete', async () => {
  const client = new NrpClient(
    clientSettings({
      bind_port: 81,
      bind_host: '192.0.2.1',
      timeout: 150,
      retry: 1,
      backoff: { min: 40, max: 40, factor: 1 },
      ping_interval: 1000,
    }),
  );
  client.start();
  try {
    await waitFor(() => client.connectAttemptAt.length >= 2, 2000);
    const gap = client.connectAttemptAt[1] - client.connectAttemptAt[0];
    assert.ok(gap >= 150, `timeout gap ${gap}`);
    assert.ok(gap < 280, `timeout gap ${gap}`);
    await delay(400);
    assert.equal(client.connectAttemptAt.length, 2);
    assert.equal(client.heartbeatWrites, 0);
  } finally {
    client.stop();
  }
});

test('a successful connect resets the reconnect budget', async (t) => {
  const sockets = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    server.close();
    setTimeout(() => socket.destroy(), 30);
  });
  const port = await listen(server);
  t.after(() => {
    sockets.forEach((socket) => socket.destroy());
  });
  const client = new NrpClient(
    clientSettings({
      bind_port: port,
      timeout: 200,
      retry: 2,
      backoff: { min: 40, max: 40, factor: 2 },
      ping_interval: 1000,
    }),
  );
  client.start();
  try {
    await waitFor(() => client.connectAttemptAt.length >= 3, 2000);
    await delay(250);
    assert.equal(client.connectAttemptAt.length, 3);
  } finally {
    client.stop();
  }
});

test('heartbeats are written while connected and stop after give-up', async (t) => {
  const sockets = [];
  const reassembler = new FrameReassembler();
  let pings = 0;
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on('data', (chunk) => {
      const frames = reassembler.push(chunk);
      pings += frames.filter((frame) => frame.type === FrameType.PING).length;
    });
  });
  const port = await listen(server);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  const client = new NrpClient(
    clientSettings({
      bind_port: port,
      timeout: 200,
      retry: 1,
      backoff: { min: 30, max: 30, factor: 1 },
      ping_interval: 30,
    }),
  );
  client.start();
  try {
    await waitFor(() => client.heartbeatWrites >= 2, 1000);
    assert.ok(pings >= 1);
    assert.equal(client.hasHeartbeat(), true);
    server.close();
    sockets.forEach((socket) => socket.destroy());
    await waitFor(() => client.hasHeartbeat() === false, 2000);
    const writes = client.heartbeatWrites;
    await delay(120);
    assert.equal(client.heartbeatWrites, writes);
    assert.equal(client.connectAttemptAt.length, 2);
  } finally {
    client.stop();
  }
});

test('stream ids stay inside 31 bits and skip ids still in flight after wrap', () => {
  const cursor = { next: 0x7ffffffe };
  const inFlight = new Set([0x7ffffffe, 2]);
  const wrapped = allocateStreamId(cursor, 2, 2, inFlight);
  assert.equal(wrapped, 4);
  inFlight.add(wrapped);
  const next = allocateStreamId(cursor, 2, 2, inFlight);
  assert.notEqual(next, wrapped);
  assert.ok(next <= MAX_STREAM_ID);
  assert.equal(next, 6);

  const oddCursor = { next: 0x7fffffff };
  const oddInFlight = new Set([1]);
  const oddMax = allocateStreamId(oddCursor, 2, 1, oddInFlight);
  assert.equal(oddMax, 0x7fffffff);
  oddInFlight.add(oddMax);
  const afterWrap = allocateStreamId(oddCursor, 2, 1, oddInFlight);
  assert.equal(afterWrap, 3);

  for (const streamId of [wrapped, next, oddMax, afterWrap]) {
    const decoded = Frame.decode(
      new Frame(FrameType.HEADERS, FrameFlag.END_HEADERS, streamId, Buffer.from('x')).encode(),
    );
    assert.equal(decoded.streamId, streamId);
    assert.ok(decoded.streamId <= 0x7fffffff);
  }

  const root = path.join(__dirname, '..');
  const vhost = fs.readFileSync(path.join(root, 'packages/server/src/manager/vhost.ts'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'packages/client/src/main.ts'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'packages/server/src/main.ts'), 'utf8');
  assert.match(vhost, /allocateStreamId/);
  assert.match(client, /allocateStreamId/);
  assert.match(server, /resolveIdleTimeout/);
});

test('two in-flight responses on one connection do not share a stream id', async (t) => {
  const { server, address } = await startNrp({ idle_timeout: 5000 });
  t.after(() => server.close());
  const control = await openControl(address.port);
  t.after(() => control.destroy());
  const frames = [];
  const reassembler = new FrameReassembler();
  control.on('data', (chunk) => {
    frames.push(...reassembler.push(chunk));
  });
  control.write(
    settingsFrame({
      secret: 'test-secret',
      bind_port: address.port,
      bind_host: '127.0.0.1',
      subdomain_host: 'example.test',
      http: { app: { subdomain: 'app', local_port: 9 } },
    }),
  );
  await waitFor(() => server.vhostManager.getNFRClient('app.example.test'));
  const first = httpRequest(address.vhostHttpPort, 'app.example.test', '/one');
  const second = httpRequest(address.vhostHttpPort, 'app.example.test', '/two');
  await waitFor(
    () => frames.filter((frame) => frame.type === FrameType.HEADERS).length >= 2,
    1000,
  );
  const ids = frames.filter((frame) => frame.type === FrameType.HEADERS).map((frame) => frame.streamId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 2);
  for (const id of ids) {
    assert.ok(id > 0 && id <= 0x7fffffff);
    assert.equal(id % 2, 0);
  }
  control.destroy();
  const responses = await Promise.all([first, second]);
  for (const response of responses) {
    assert.ok(response.status >= 400);
  }
  assert.equal(server.vhostManager.inFlightCount(), 0);
});

test('a closed control socket drops its vhost and later requests fail closed', async (t) => {
  const { upstream, hits } = startUpstream();
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise((resolve) => upstream.close(() => resolve())));
  const { server, address } = await startNrp({ idle_timeout: 5000 });
  t.after(() => server.close());
  const control = await openControl(address.port);
  control.write(
    settingsFrame({
      secret: 'test-secret',
      bind_port: address.port,
      bind_host: '127.0.0.1',
      subdomain_host: 'example.test',
      http: { app: { subdomain: 'app', local_port: upstreamPort } },
    }),
  );
  await waitFor(() => server.vhostManager.getNFRClient('app.example.test'));
  const pending = httpRequest(address.vhostHttpPort, 'app.example.test', '/live');
  await delay(40);
  control.destroy();
  const response = await Promise.race([
    pending,
    delay(1000).then(() => {
      throw new Error('request hung after the control socket closed');
    }),
  ]);
  assert.ok(response.status >= 400);
  assert.equal(response.body.includes(UPSTREAM_BODY), false);
  assert.equal(server.vhostManager.getNFRClient('app.example.test'), undefined);
  assert.equal(server.vhostManager.inFlightCount(), 0);
  const again = await httpRequest(address.vhostHttpPort, 'app.example.test', '/later');
  assert.ok(again.status >= 400);
  assert.equal(again.body.includes(UPSTREAM_BODY), false);
  assert.equal(hits.length, 0);
});

test('idle timeout closes a silent socket and not one that still receives heartbeats', async (t) => {
  assert.equal(resolveIdleTimeout({ port: 1, vhost_http_port: 2 }), 60000);
  assert.equal(resolveIdleTimeout({ port: 1, vhost_http_port: 2, idle_timeout: 180 }), 180);

  const defaults = await startNrp({ idle_timeout: undefined });
  t.after(() => defaults.server.close());
  const steady = await openControl(defaults.address.port);
  t.after(() => steady.destroy());
  await delay(400);
  assert.equal(steady.destroyed, false);

  const { server, address } = await startNrp({ idle_timeout: 180 });
  t.after(() => server.close());
  const silent = await openControl(address.port);
  silent.on('error', () => {});
  const silentStarted = Date.now();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('silent control socket stayed open')), 1000);
    silent.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const silentElapsed = Date.now() - silentStarted;
  assert.ok(silentElapsed >= 150, `silent close ${silentElapsed}`);
  assert.ok(silentElapsed < 700, `silent close ${silentElapsed}`);

  const beating = await openControl(address.port);
  beating.on('error', () => {});
  const pulse = setInterval(() => {
    if (!beating.destroyed) {
      beating.write(new Frame(FrameType.PING, FrameFlag.END_STREAM, 1, Buffer.alloc(0)).encode());
    }
  }, 40);
  t.after(() => clearInterval(pulse));
  await delay(500);
  assert.equal(beating.destroyed, false);
  clearInterval(pulse);
  const quietStarted = Date.now();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket stayed open after heartbeats stopped')), 1000);
    beating.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const quietElapsed = Date.now() - quietStarted;
  assert.ok(quietElapsed >= 150, `quiet close ${quietElapsed}`);
  assert.ok(quietElapsed < 700, `quiet close ${quietElapsed}`);
});
