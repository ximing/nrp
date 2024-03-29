import * as net from 'net';
import { Frame, FrameFlag, FrameType, HandleStream, NrpServerConfig } from '@nrpjs/shared';
import { ClientManager } from './manager/client';
import { VhostManager } from './manager/vhost';
import { Buffer } from 'buffer';
import { log } from './logger';

export class NrpServer {
  nrps!: net.Server;
  clientManager: ClientManager;
  vhostManager: VhostManager;

  private handleStream = new HandleStream();

  constructor(private config: NrpServerConfig) {
    this.clientManager = new ClientManager(this);
    this.vhostManager = new VhostManager(this);
  }

  getConfig() {
    return this.config;
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
    this.handleStream.register(this.vhostManager.handleNrpcResHeaders);
    this.handleStream.register(this.vhostManager.handleNrpcResData);

    this.nrps = net.createServer((nrpClient) => {
      log.info(`new client connected,${nrpClient.remoteAddress}:${nrpClient.remotePort}`);

      nrpClient.on('data', (chunk) => {
        log.info(`receive nrpClient chunk`);
        this.handleStream.parse(chunk, nrpClient);
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
        // nrp客户端断开连接，这时候，存在ws的情况需要断开ws
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
        const meta = this.clientManager.getMeta(nrpClient);
        log.info(`nrpClient disconnected ${meta?.id}`);
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
    this.vhostManager.start();
  }
}
