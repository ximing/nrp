import * as net from 'net';
import { Request, Response } from 'express';
import { Buffer } from 'buffer';
import { ClientHttpSetting, Frame, FrameFlag, FrameType } from '@nrpjs/shared';
import { NrpServer } from '../main';
import { logGen } from '../logger';

const log = logGen('[vhost] ');

export class VhostManager {
  constructor(private nrpServer: NrpServer) {}

  private hostMap = new Map<string, net.Socket>();
  private streamId = 0;
  private streamMap = new Map<number, Response>();

  setVhost(subdomain_host: string, httpSettings: ClientHttpSetting, nfrClient: net.Socket) {
    Object.values(httpSettings).forEach((setting) => {
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
    return this.streamMap.get(id);
  }

  closeStream(id: number) {
    log.info(`close stream ${id}`);
    this.streamMap.delete(id);
  }

  getStreamId() {
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
      log.info(`request host: ${host}`);
      const nfrClient = this.getNFRClient(host);
      if (nfrClient) {
        // 将HTTP请求封装成帧，传递给nrp client
        // TODO 取余，防止溢出
        const streamId = this.getStreamId();
        log.info(`vhost streamId: ${streamId}`);
        this.streamMap.set(streamId, res);
        const headersStr = JSON.stringify({
          method: req.method,
          path: req.path,
          host,
          headers: req.headers,
        });
        const payload = Buffer.from(headersStr, 'utf8');
        nfrClient.write(
          new Frame(FrameType.HEADERS, FrameFlag.END_HEADERS, streamId, payload).encode(),
          () => {
            log.info(`sent headers, ${headersStr}`);
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
        res.status(500).send('nfrs socket not found');
      }
    } else {
      res.status(500).send('nfrs host not found');
    }
  };

  // 处理服务端
  handleResHeaders = (frame: Frame, nrpClient: net.Socket) => {
    if (frame.isHeaders) {
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

  handleResData = (frame: Frame, nrpClient: net.Socket) => {
    if (frame.isData) {
      const res = this.getResponse(frame.streamId);
      if (res) {
        if (frame.isDataEnd) {
          res.end();
          log.info(`streamId: ${frame.streamId} receive data end`);
          // 处理完成，关闭stream
          this.closeStream(frame.streamId);
        } else {
          log.info(`streamId: ${frame.streamId} receive data frame ${frame.length} bytes`);
          res.write(frame.payload);
        }
      }
    }
  };
}
