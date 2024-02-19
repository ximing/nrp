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

  private controlSockets = new Set<net.Socket>();

  constructor(private config: NrpServerConfig) {
    this.clientManager = new ClientManager(this);
    this.vhostManager = new VhostManager(this);
  }

  getConfig() {
    return this.config;
  }

  handleSettings = (frame: Frame, nrpClient: net.Socket) => {
    if (!frame.isSettings) {
      return;
    }
    let settings: unknown;
    try {
      settings = JSON.parse(frame.payload.toString('utf8'));
    } catch (err) {
      log.error(err as Error);
      return;
    }
    const id = this.clientManager.setClient(nrpClient, settings);
    if (id == null) {
      return;
    }
    log.info(`nrpClient Id, ${id}`);
    try {
      nrpClient.write(
        new Frame(
          FrameType.SETTINGS,
          FrameFlag.END_STREAM,
          frame.streamId,
          Buffer.from(JSON.stringify({ id }), 'utf-8'),
        ).encode(),
      );
    } catch (err) {
      log.error(err as Error);
    }
  };

  start() {
    this.handleStream.register(this.handleSettings);
    this.handleStream.register(this.vhostManager.handleNrpcResHeaders);
    this.handleStream.register(this.vhostManager.handleNrpcResData);

    this.nrps = net.createServer((nrpClient) => {
      log.info(`new client connected,${nrpClient.remoteAddress}:${nrpClient.remotePort}`);
      this.controlSockets.add(nrpClient);

      const idle = this.config.idle_timeout ?? 60000;
      nrpClient.setTimeout(idle);
      nrpClient.on('timeout', () => {
        log.info('control socket idle timeout');
        nrpClient.end();
      });

      nrpClient.on('data', (chunk) => {
        log.info(`receive nrpClient chunk`);
        try {
          this.handleStream.parse(chunk, nrpClient);
        } catch (err) {
          log.error(err as Error);
          nrpClient.destroy();
        }
      });

      // 监听关闭事件
      nrpClient.on('close', () => {
        log.info('Connection closed');
        this.controlSockets.delete(nrpClient);
        this.handleStream.drop(nrpClient);
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
    });

    return new Promise((resolve, reject) => {
      this.nrps.once('error', reject);
      this.nrps.listen(this.config.port, () => {
        this.nrps.removeListener('error', reject);
        this.nrps.on('error', (err) => {
          log.error(err);
        });
        const listening = this.nrps.address();
        const port = listening && typeof listening === 'object' ? listening.port : this.config.port;
        log.info(`Server listening on port ${port}`);
        this.vhostManager.start().then(
          (vhostHttpPort) => {
            resolve({ port, vhostHttpPort });
          },
          reject,
        );
      });
    });
  }

  close(): Promise<void> {
    for (const socket of this.controlSockets) {
      socket.destroy();
    }
    return this.vhostManager.close().then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.nrps) {
            resolve();
            return;
          }
          const listening = this.nrps as net.Server & { closeAllConnections?: () => void };
          if (typeof listening.closeAllConnections === 'function') {
            listening.closeAllConnections();
          }
          this.nrps.close((err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        }),
    );
  }
}
