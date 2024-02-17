import * as net from 'net';
import { Buffer } from 'buffer';

import { ClientSettings, Frame, FrameFlag, FrameType, HandleStream } from '@nrpjs/shared';
import { VhostClient } from './manager/vhost';
import { log } from './logger';

// const MAX_RECONNECT_ATTEMPTS = 5; // 最大重连尝试次数
const RECONNECT_INTERVAL = 3000; // 重连尝试之间的延迟时间（毫秒）

export class NrpClient {
  constructor(private settings: ClientSettings) {
    this.vhostClient = new VhostClient(this);
  }
  private nrpc: net.Socket | null = null;
  private vhostClient: VhostClient;
  private streamId = 1;
  private handleStream = new HandleStream();
  private retryCount = 0;

  getStreamId() {
    const streamId = this.streamId;
    this.streamId = streamId + 2;
    return streamId;
  }

  getSettings() {
    return this.settings;
  }
  private ping() {
    setInterval(() => {
      if (this.nrpc) {
        this.nrpc.write(
          new Frame(
            FrameType.PING,
            FrameFlag.END_STREAM,
            this.getStreamId(),
            Buffer.alloc(0),
          ).encode(),
        );
      }
    }, 10000);
  }

  handleSettings = (frame: Frame, nrpc: net.Socket) => {
    if (frame.isSettings) {
      const setting = frame.decodePayload('utf-8', false);
      log.info(`receive settings, ${setting}`);
    }
  };

  start() {
    this.handleStream.register(this.handleSettings);
    this.handleStream.register(this.vhostClient.handleNrpsReqHeaders);
    this.handleStream.register(this.vhostClient.handleNrpsReqData);
    this.vhostClient.initSettings();
    this.connect();
    this.ping();
  }

  private tryReconnect() {
    setTimeout(() => {
      log.info(`tryReconnect: ${++this.retryCount}`);
      this.connect();
    }, RECONNECT_INTERVAL);
  }

  private connect() {
    const nrpc = new net.Socket();
    nrpc.connect(this.settings.bind_port, this.settings.bind_host, () => {
      log.info(`Connected to nrps ${this.settings.bind_host}:${this.settings.bind_port}`);
      this.retryCount = 0;
      // 发送数据到服务器
      nrpc.write(
        new Frame(
          FrameType.SETTINGS,
          FrameFlag.PADDED,
          this.streamId,
          Buffer.from(JSON.stringify(this.settings), 'utf-8'),
        ).encode(),
      );

      this.nrpc = nrpc;
    });
    // 当从服务器接收到数据时触发
    nrpc.on('data', (data) => {
      log.info(`nrpc:data receive server chunk`);
      this.handleStream.parse(data, nrpc);
    });

    // 当连接关闭时触发
    nrpc.on('close', (hadError) => {
      log.info(`nrpc:close Connection closed hadError: ${hadError}`);
      this.nrpc = null;
      this.tryReconnect();
    });

    nrpc.on('end', () => {
      log.info('nrpc:end Disconnected from server');
      // 服务器正常关闭连接，可能不需要重连
      // 如果需要在正常断开后也尝试重连，请在此处调用tryReconnect()
    });

    // 当发生错误时触发
    nrpc.on('error', (err) => {
      log.info('nrpc:error');
      log.error(err);
      nrpc.destroy();
    });
  }
}
