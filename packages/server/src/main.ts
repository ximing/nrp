import * as net from 'net';
import express, { Express } from 'express';
import { Frame, FrameFlag, FrameType, HandleStream, NrpServerConfig } from '@nrpjs/shared';
import { ClientManager } from './manager/client';
import { VhostManager } from './manager/vhost';
import { Buffer } from 'buffer';
import { log } from './logger';

export class NrpServer {
  nrps!: net.Server;
  vhostServer!: Express;
  clientManager: ClientManager;
  vhostManager: VhostManager;

  private handleStream = new HandleStream();

  constructor(private config: NrpServerConfig) {
    this.clientManager = new ClientManager(this);
    this.vhostManager = new VhostManager(this);
  }

  handleSettings = (frame: Frame, nrpClient: net.Socket) => {
    if (frame.isSettings) {
      const settingsStr = frame.payload.toString('utf8');
      log.info(`settings, ${settingsStr}`);
      const settings = JSON.parse(settingsStr);
      const id = this.clientManager.setClient(nrpClient, settings);
      log.info(`nrpClient Id, ${id}`);
      nrpClient.write(
        new Frame(
          FrameType.SETTINGS,
          FrameFlag.END_STREAM,
          frame.streamId,
          Buffer.from(JSON.stringify({ id }), 'utf-8'),
        ).encode(),
      );
    }
  };

  start() {
    this.handleStream.register(this.handleSettings);
    this.handleStream.register(this.vhostManager.handleResHeaders);
    this.handleStream.register(this.vhostManager.handleResData);

    this.nrps = net.createServer((nrpClient) => {
      log.info(`new client connected,${nrpClient.remoteAddress}:${nrpClient.remotePort}`);

      nrpClient.on('data', (data) => {
        this.handleStream.parse(data, nrpClient);
      });

      // 监听关闭事件
      nrpClient.on('close', () => {
        log.info('Connection closed');
        const meta = this.clientManager.getMeta(nrpClient);
        if (meta) {
          log.info(`closed client id,${meta.id}`);
          this.clientManager.rmClient(meta.id);
          this.clientManager.rmMeta(nrpClient);
        }
      });

      // 监听错误事件
      nrpClient.on('error', (err) => {
        log.error(err);
        nrpClient.end();
      });

      // 监听连接结束事件，
      // 当客户端发出 FIN 包，请求关闭连接时，会触发此事件。
      // 这是一个表明客户端想要结束连接的半关闭状态，此时服务器端仍可以发送数据，但是一旦所有数据发送完毕，连接将被关闭。
      nrpClient.on('end', () => {
        console.log('Client disconnected');
      });

      // 可以选择设置超时监听器
      nrpClient.setTimeout(60000); // 设置超时时间，例如 60 秒
      nrpClient.on('timeout', () => {
        console.log('Socket timeout');
        nrpClient.end(); // 结束连接
      });
    });

    this.nrps.listen(this.config.port, () => {
      log.info(`Server listening on port ${this.config.port}`);
    });
    this.startVhost();
  }

  private startVhost() {
    this.vhostServer = express();
    this.vhostServer.all('*', (req, res) => {
      this.vhostManager.handleHttp(req, res);
    });
    this.vhostServer.listen(this.config.vhost_http_port, () => {
      log.info(`VHost listening on port ${this.config.vhost_http_port}`);
    });
  }
}
