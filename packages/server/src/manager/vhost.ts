import * as net from 'net';
import * as http from 'http';
import { Buffer } from 'buffer';
import express, { Express, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientHttpSetting, Frame, FrameFlag, FrameType } from '@nrpjs/shared';
import { NrpServer } from '../main';
import { logGen } from '../logger';
import stream from 'node:stream';

const log = logGen('[vhost] ');

export class VhostManager {
  constructor(private nrpServer: NrpServer) {}
  vhostApp!: Express;
  vhostServer!: http.Server;
  wsServer!: WebSocketServer;

  private hostMap = new Map<string, net.Socket>();
  private streamId = 2;
  private responseMap = new Map<number, Response>();
  private wsStreamMap = new Map<WebSocket, number>();
  private streamWsMap = new Map<number, WebSocket>();

  start() {
    const app = express();
    const server = http.createServer(app);
    const wsServer = new WebSocketServer({ clientTracking: false, noServer: true });
    this.vhostServer = server;
    this.vhostApp = app;
    this.wsServer = wsServer;
    server.on('upgrade', this.handleWsRequest);
    wsServer.on('connection', this.handleWsConnection);
    app.all('*', this.handleHttpRequest);
    // 使用创建的HTTP服务器监听端口，而不是直接使用Express的监听方法
    server.listen(this.nrpServer.getConfig().vhost_http_port, () => {
      log.info(`VHost listening on port ${this.nrpServer.getConfig().vhost_http_port}`);
    });
  }

  setVhost(subdomain_host: string, httpSettings: ClientHttpSetting, nfrClient: net.Socket) {
    Object.values(httpSettings).forEach((setting) => {
      // @ts-ignore
      const { subdomain } = setting;
      const domain = `${subdomain}.${subdomain_host}`;
      this.hostMap.set(domain, nfrClient);
    });
  }

  rmVhost(nfrClient: net.Socket) {
    const deleteKeys = [];
    for (const [key, value] of this.hostMap) {
      if (value === nfrClient) {
        deleteKeys.push(key);
      }
    }
    deleteKeys.forEach((key) => this.hostMap.delete(key));
  }

  getNFRClient(domain: string) {
    return this.hostMap.get(domain);
  }

  getResponse(id: number) {
    return this.responseMap.get(id);
  }

  closeStream(id: number) {
    log.info(`close stream ${id}`);
    this.responseMap.delete(id);
    const ws = this.streamWsMap.get(id);
    if (ws) {
      this.streamWsMap.delete(id);
      this.wsStreamMap.delete(ws);
    }
  }

  getStreamId() {
    // TODO 取余，防止溢出
    const streamId = this.streamId;
    this.streamId = streamId + 2;
    return streamId;
  }

  /*
   * 处理HTTP请求，将请求转发给nfr client
   * */
  handleHttpRequest = (req: Request, res: Response) => {
    const host = req.headers.host;
    if (host) {
      log.info(`handleHttpRequest request host: ${host}`);
      const nfrClient = this.getNFRClient(host);
      if (nfrClient) {
        // 将HTTP请求封装成帧，传递给nrp client
        const streamId = this.getStreamId();
        log.info(`handleHttpRequest vhost streamId: ${streamId}`);
        this.responseMap.set(streamId, res);
        const headersStr = JSON.stringify({
          method: req.method,
          path: req.url,
          host,
          headers: req.headers,
        });
        const payload = Buffer.from(headersStr, 'utf8');
        nfrClient.write(
          new Frame(FrameType.HEADERS, FrameFlag.END_HEADERS, streamId, payload).encode(),
          () => {
            log.info(`handleHttpRequest sent headers, ${headersStr}`);
          },
        );
        req.on('data', (chunk) => {
          nfrClient.write(new Frame(FrameType.DATA, FrameFlag.PADDED, streamId, chunk).encode());
        });
        req.on('end', () => {
          nfrClient.write(
            new Frame(FrameType.DATA, FrameFlag.END_DATA, streamId, Buffer.alloc(0)).encode(),
          );
        });
        req.on('close', () => {
          // this.closeStream(streamId);
        });
        // res.on('close', () => {
        //   this.closeStream(streamId);
        // });
      } else {
        res.status(500).send('handleHttpRequest nfrClient not found');
      }
    } else {
      res.status(500).send('handleHttpRequest host not found');
    }
  };

  /*
   * 处理websocket请求，将请求转发给nfr client
   * */
  handleWsRequest = (request: http.IncomingMessage, socket: stream.Duplex, head: Buffer) => {
    socket.on('error', () => {});
    const host = request.headers.host;
    if (host) {
      const nfrClient = this.getNFRClient(host);
      if (nfrClient) {
        const streamId = this.getStreamId();
        const headersStr = JSON.stringify({
          path: request.url,
          host,
          headers: request.headers,
        });
        const payload = Buffer.from(headersStr, 'utf8');
        nfrClient.write(
          new Frame(FrameType.WS_HEADERS, FrameFlag.END_HEADERS, streamId, payload).encode(),
        );
        this.wsServer.handleUpgrade(request, socket, head, (ws) => {
          // @ts-ignore
          ws.nfrClient = nfrClient;
          this.wsStreamMap.set(ws, streamId);
          this.streamWsMap.set(streamId, ws);
          this.wsServer.emit('connection', ws, request);
        });
      } else {
        socket.write('HTTP/1.1 500 nfrClient not found\r\n\r\n');
        log.error(`ws nfrClient not found`);
        socket.destroy();
      }
    } else {
      socket.write('HTTP/1.1 500 host not found\r\n\r\n');
      log.error(`ws host not found`);
      socket.destroy();
    }
  };

  handleWsConnection = (ws: WebSocket) => {
    ws.on('message', (data, isBinary) => {
      const streamId = this.wsStreamMap.get(ws);
      if (streamId) {
        // @ts-ignore
        ws.nfrClient.write(
          new Frame(FrameType.WS_DATA, FrameFlag.PADDED, streamId, data as Buffer).encode(),
        );
      } else {
        log.error('ws:message not found streamId');
      }
    });
    // 监听断开连接
    ws.on('close', () => {
      const streamId = this.wsStreamMap.get(ws);
      if (streamId) {
        log.info('ws Client disconnected');
        // 在这里执行断开连接后的清理工作
        // @ts-ignore
        ws.nfrClient.write(
          new Frame(FrameType.WS_DATA, FrameFlag.END_DATA, streamId, Buffer.alloc(0)).encode(),
        );
      } else {
        log.error('ws:close not found streamId');
      }
    });
  };

  // 处理服务端
  handleNrpcResHeaders = (frame: Frame, nrpClient: net.Socket) => {
    if (frame.isHTTPHeaders) {
      const res = this.getResponse(frame.streamId);
      if (res) {
        const headersStr = frame.payload.toString('utf-8');
        log.info(`streamId: ${frame.streamId} receive response headers ${headersStr}`);
        const { headers, statusCode } = JSON.parse(headersStr);
        res.set(headers);
        res.status(statusCode);
      } else {
        log.warn(`response not found streamId: ${frame.streamId}`);
      }
    }
  };

  // 处理nrpc传递过来的数据
  handleNrpcResData = (frame: Frame, nrpClient: net.Socket) => {
    if (frame.isData) {
      log.info(
        `handleNrpcResData receiveData streamId: ${frame.streamId} frameType: ${frame.type} frameFlag: ${frame.flag} ${frame.isHttpData}`,
      );
      // 处理HTTP响应数据
      if (frame.isHttpData) {
        const response = this.getResponse(frame.streamId);
        if (response) {
          if (frame.isDataEnd) {
            response.end();
            log.info(`handleNrpcResData streamId: ${frame.streamId}  http receive data end`);
            // 处理完成，关闭stream
            this.closeStream(frame.streamId);
          } else {
            log.info(
              `handleNrpcResData streamId: ${frame.streamId} http receive data frame ${frame.length} bytes`,
            );
            response.write(frame.payload);
          }
        } else {
          log.error(`handleNrpcResData streamId: ${frame.streamId} not found response`);
        }
      } else {
        const ws = this.streamWsMap.get(frame.streamId);
        if (ws) {
          if (frame.isDataEnd) {
            log.info(`handleNrpcResData streamId: ${frame.streamId} ws receive data end`);
            ws.close();
            // 处理完成，关闭stream
            this.closeStream(frame.streamId);
          } else {
            log.info(
              `handleNrpcResData streamId: ${frame.streamId} ws receive data frame ${frame.length} bytes`,
            );
            const binaryFlag = frame.payload[0];
            const data = frame.payload.subarray(1);
            if (binaryFlag === 1) {
              ws.send(data);
            } else {
              ws.send(data.toString('utf-8'));
            }
          }
        } else {
          log.error('handleNrpcResData not found ws');
        }
      }
    }
  };
}
