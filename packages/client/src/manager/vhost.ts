import { Frame, FrameFlag, FrameType } from '@nrpjs/shared';
import * as net from 'net';
import * as http from 'http';
import { NrpClient } from '../main';
import { Buffer } from 'buffer';
import { log } from '../logger';
import WebSocket from 'ws';

export class VhostClient {
  constructor(private nrpClient: NrpClient) {}
  private hostConfMap = new Map<
    string,
    {
      local_port: number;
    }
  >();

  private reqMap = new Map<number, http.ClientRequest>();
  private wsMap = new Map<number, WebSocket>();

  initSettings() {
    Object.values(this.nrpClient.getSettings().http).forEach((value) => {
      this.hostConfMap.set(`${value.subdomain}.${this.nrpClient.getSettings().subdomain_host}`, {
        local_port: value.local_port,
      });
    });
  }

  handleNrpsReqHeaders = (frame: Frame, nrpc: net.Socket) => {
    if (frame.isHeaders) {
      log.info(
        `handleNrpsReqHeaders streamId: ${frame.streamId} type:${frame.type} flag:${frame.flag}`,
      );
      const headers = frame.decodePayload('utf-8', true) || {};
      log.info(`handleNrpsReqHeaders receive headers: ${JSON.stringify(headers)}`);
      if (headers.host) {
        delete headers.headers.host;
        delete headers.headers.hostname;
        const conf = this.hostConfMap.get(headers.host);
        if (conf) {
          if (frame.isHTTPHeaders) {
            const requestOpt = {
              ...headers,
              host: '127.0.0.1',
              port: conf.local_port,
            };
            delete requestOpt.type;
            // log.info(`${JSON.stringify(requestOpt)}`);
            const req = http.request(requestOpt, (res) => {
              log.info(`statusCode: ${res.statusCode}`);
              nrpc.write(
                new Frame(
                  FrameType.HEADERS,
                  FrameFlag.END_HEADERS,
                  frame.streamId,
                  Buffer.from(
                    JSON.stringify({
                      headers: res.headers,
                      statusCode: res.statusCode,
                    }),
                    'utf-8',
                  ),
                ).encode(),
              );
              res.on('data', (chunk) => {
                log.info(`http.request data ${frame.streamId}`);
                nrpc.write(
                  new Frame(FrameType.DATA, FrameFlag.PADDED, frame.streamId, chunk).encode(),
                );
              });
              res.on('close', () => {
                log.info(`http.request close ${frame.streamId}`);
                nrpc.write(
                  new Frame(
                    FrameType.DATA,
                    FrameFlag.END_DATA,
                    frame.streamId,
                    Buffer.alloc(0),
                  ).encode(),
                );
              });
              res.on('error', (err) => {
                log.error(`http.request error ${frame.streamId}`);
                log.error(err);
              });
            });
            this.reqMap.set(frame.streamId, req);
          } else {
            const url = `ws://127.0.0.1:${conf.local_port}${headers.path}`;
            const protocol = headers.headers['sec-websocket-protocol'];
            log.info(`create ws url: ${url}`);
            const options = {
              // perMessageDeflate: false,
              headers: headers.headers,
            };
            const ws = protocol
              ? new WebSocket(url, protocol, options)
              : new WebSocket(url, options);
            this.wsMap.set(frame.streamId, ws);
            ws.on('open', () => {
              log.info(`ws:open streamId:${frame.streamId}`);
            });
            ws.on('message', (data, isBinary: boolean) => {
              log.info(`ws:message streamId:${frame.streamId}`);
              log.info(`${isBinary},${data}${typeof data}${Buffer.isBuffer(data)}`);
              const binaryFlag = Buffer.alloc(1);
              binaryFlag.writeUint8(isBinary ? 1 : 0);
              nrpc.write(
                new Frame(
                  FrameType.WS_DATA,
                  FrameFlag.PADDED,
                  frame.streamId,
                  Buffer.concat([binaryFlag, data as Buffer]),
                ).encode(),
              );
            });
            ws.on('close', (err) => {
              nrpc.write(
                new Frame(
                  FrameType.WS_DATA,
                  FrameFlag.END_DATA,
                  frame.streamId,
                  Buffer.alloc(0),
                ).encode(),
              );
            });
          }
        } else {
          log.warn(`nrpc host not found`);
          nrpc.write(
            new Frame(
              FrameType.DATA,
              FrameFlag.END_DATA,
              frame.streamId,
              Buffer.from(`nrpc host not found`, 'utf-8'),
            ).encode(),
          );
        }
      } else {
        log.warn(`nrpc ${frame.isHTTPHeaders ? 'http' : 'ws'} need host`);
        nrpc.write(
          new Frame(
            FrameType.DATA,
            FrameFlag.END_DATA,
            frame.streamId,
            Buffer.from(`nrpc need host`, 'utf-8'),
          ).encode(),
        );
      }
    }
  };

  // 处理 nrps 传递过来的数据
  handleNrpsReqData = (frame: Frame, nrpc: net.Socket) => {
    if (frame.isData) {
      log.info(
        `handleNrpsReqData streamId: ${frame.streamId} type:${frame.type} flag:${frame.flag} ${frame.isHttpData}`,
      );
      if (frame.isHttpData) {
        // HTTP 请求
        const req = this.reqMap.get(frame.streamId);
        if (!req) {
          nrpc.write(
            new Frame(
              FrameType.DATA,
              FrameFlag.END_DATA,
              frame.streamId,
              Buffer.from(`nrpc req not found`, 'utf-8'),
            ).encode(),
          );
          return;
        }
        if (frame.isDataEnd) {
          req.end();
          this.reqMap.delete(frame.streamId);
        } else {
          req.write(frame.payload);
        }
      } else {
        // WS  请求
        const ws = this.wsMap.get(frame.streamId);
        if (!ws) {
          nrpc.write(
            new Frame(
              FrameType.WS_DATA,
              FrameFlag.END_DATA,
              frame.streamId,
              Buffer.from(`nrpc req not found`, 'utf-8'),
            ).encode(),
          );
          return;
        }
        if (frame.isDataEnd) {
          ws.close();
          this.wsMap.delete(frame.streamId);
        } else {
          ws.send(frame.payload);
        }
      }
    }
  };
}
