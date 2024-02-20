import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

export type PanelResult = { ok: true; config: unknown } | { ok: false; reason: string };

export type PanelHandlers = {
  role: 'server' | 'client';
  getConfig: () => unknown;
  putConfig: (patch: unknown) => PanelResult;
  addProxy?: (entry: unknown) => PanelResult;
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
  extra?: Record<string, string>,
) {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(body);
}

function unauthorized(res: http.ServerResponse) {
  send(res, 401, 'Unauthorized', 'text/plain; charset=utf-8', {
    'www-authenticate': 'Basic realm="nrp"',
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeFile(staticDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) {
    return null;
  }
  const root = path.resolve(staticDir);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) {
    return null;
  }
  return full;
}

export function startPanel(options: {
  addr: string;
  port: number;
  authorize: (authorization: string | undefined) => boolean;
  staticDir: string;
  handlers: PanelHandlers;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    try {
      if (!options.authorize(req.headers.authorization)) {
        unauthorized(res);
        return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      if (req.method === 'GET' && pathname === '/api/meta') {
        send(res, 200, JSON.stringify({ role: options.handlers.role }), 'application/json; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && pathname === '/api/config') {
        send(res, 200, JSON.stringify(options.handlers.getConfig()), 'application/json; charset=utf-8');
        return;
      }
      if ((req.method === 'PUT' && pathname === '/api/config') || (req.method === 'POST' && pathname === '/api/proxies')) {
        const raw = await readBody(req);
        let payload: unknown;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          send(res, 400, JSON.stringify({ error: 'invalid json' }), 'application/json; charset=utf-8');
          return;
        }
        if (req.method === 'POST') {
          if (!options.handlers.addProxy) {
            send(res, 404, JSON.stringify({ error: 'proxies are client settings' }), 'application/json; charset=utf-8');
            return;
          }
          const result = options.handlers.addProxy(payload);
          if (!result.ok) {
            send(res, 400, JSON.stringify({ error: result.reason }), 'application/json; charset=utf-8');
            return;
          }
          send(res, 200, JSON.stringify(result.config), 'application/json; charset=utf-8');
          return;
        }
        const result = options.handlers.putConfig(payload);
        if (!result.ok) {
          send(res, 400, JSON.stringify({ error: result.reason }), 'application/json; charset=utf-8');
          return;
        }
        send(res, 200, JSON.stringify(result.config), 'application/json; charset=utf-8');
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const file = safeFile(options.staticDir, pathname);
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          send(res, 404, 'Not found', 'text/plain; charset=utf-8');
          return;
        }
        const body = fs.readFileSync(file);
        const type = TYPES[path.extname(file)] || 'application/octet-stream';
        res.writeHead(200, {
          'content-type': type,
          'content-length': body.length,
          'cache-control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    } catch {
      if (!res.headersSent) {
        send(res, 500, 'Error', 'text/plain; charset=utf-8');
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.addr, () => {
      server.removeListener('error', reject);
      const listening = server.address();
      const port = listening && typeof listening === 'object' ? listening.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            const closer = server as http.Server & { closeAllConnections?: () => void };
            if (typeof closer.closeAllConnections === 'function') {
              closer.closeAllConnections();
            }
            server.close(() => done());
          }),
      });
    });
  });
}
