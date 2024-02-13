import { Frame, FrameFlag, FrameType } from '@nrpjs/shared';
import * as net from 'net';
import * as http from 'http';
import { NrpClient } from '../main';
import { Buffer } from 'buffer';
import { log } from '../logger';

export class VhostClient {
  constructor(private nrpClient: NrpClient) {}
  private hostConfMap = new Map<
    string,
    {
      local_port: number;
    }
  >();

  private reqMap = new Map<number, http.ClientRequest>();

  initSettings() {
    Object.values(this.nrpClient.getSettings().http).forEach((value) => {
      this.hostConfMap.set(`${value.subdomain}.${this.nrpClient.getSettings().subdomain_host}`, {
        local_port: value.local_port,
      });
    });
  }

  handleReqHeaders = (frame: Frame, nrpc: net.Socket) => {
    if (frame.isHeaders) {
      const headers = frame.decodePayload('utf-8', true) || {};
      log.info(`receive headers: ${JSON.stringify(headers)}`);
      if (headers.host) {
        const conf = this.hostConfMap.get(headers.host);
        if (conf) {
          delete headers.host;
          const requestOpt = {
            ...headers,
            host: '127.0.0.1',
            port: conf.local_port,
          };
          delete requestOpt.headers.host;
          delete requestOpt.headers.hostname;
          log.info(`${JSON.stringify(requestOpt)}`);
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
              log.info('http request chunk');
              nrpc.write(
                new Frame(FrameType.DATA, FrameFlag.PADDED, frame.streamId, chunk).encode(),
              );
            });
            res.on('close', () => {
              log.info('http request close');
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
              log.error(err);
            });
          });
          this.reqMap.set(frame.streamId, req);
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
        log.warn(`nrpc need host`);
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

  handleReqData = (frame: Frame, nrpc: net.Socket) => {
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
    if (frame.isData) {
      if (frame.isDataEnd) {
        req.end();
      } else {
        req.write(frame.payload);
      }
    }
  };
}
