const http = require('http');
const net = require('net');
const { Frame, FrameFlag, FrameType } = require('@nrpjs/shared');
const { NrpServer } = require('@nrpjs/server');

const UPSTREAM_BODY = 'upstream-body-token';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('server has no port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function settingsFrame(settings) {
  return new Frame(
    FrameType.SETTINGS,
    FrameFlag.PADDED,
    1,
    Buffer.from(JSON.stringify(settings), 'utf8'),
  ).encode();
}

async function startNrp(config = {}) {
  const server = new NrpServer({
    port: 0,
    vhost_http_port: 0,
    secret: 'test-secret',
    idle_timeout: 5000,
    ...config,
  });
  const address = await server.start();
  return { server, address };
}

function openControl(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => resolve(socket));
    socket.once('error', reject);
  }).then((socket) => {
    socket.on('error', () => {});
    return socket;
  });
}

function httpRequest(port, host, path = '/') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Host: host },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function startUpstream() {
  const hits = [];
  const upstream = http.createServer((req, res) => {
    hits.push(req.url || '/');
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(UPSTREAM_BODY);
  });
  return { upstream, hits };
}

function waitFor(fn, ms = 1500) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value;
      try {
        value = fn();
      } catch (err) {
        reject(err);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start > ms) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

module.exports = {
  UPSTREAM_BODY,
  delay,
  listen,
  settingsFrame,
  startNrp,
  openControl,
  httpRequest,
  startUpstream,
  waitFor,
};
