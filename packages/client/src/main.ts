import * as net from 'net';
import { Buffer } from 'buffer';

import { ClientSettings, Frame, FrameFlag, FrameType, HandleStream } from '@nrpjs/shared';
import { VhostClient } from './manager/vhost';
import { log } from './logger';

// const MAX_RECONNECT_ATTEMPTS = 5; // 最大重连尝试次数
// const RECONNECT_INTERVAL = 3000; // 重连尝试之间的延迟时间（毫秒）
//
//
// let reconnectAttempts = 0;
//
// function connectToServer() {
//   const client = net.connect({ port: 5000, host: 'nfrp-server-address' }, () => {
//     console.log('Connected to server');
//     reconnectAttempts = 0; // 重置重连尝试次数
//   });
//   client.on('data', (data) => {
//     // 处理接收到的数据...
//   });
//
//   client.on('end', () => {
//     console.log('Disconnected from server');
//     // 服务器正常关闭连接，可能不需要重连
//     // 如果需要在正常断开后也尝试重连，请在此处调用tryReconnect()
//   });
//
//   client.on('error', (err) => {
//     console.error('Connection error:', err);
//   });
//
//   client.on('close', (hadError) => {
//     console.log('Connection closed');
//     if (!hadError) {
//       tryReconnect(client);
//     }
//   });
// }
//
// function tryReconnect(client: net.Socket) {
//   if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
//     reconnectAttempts++;
//     console.log(`Attempt ${reconnectAttempts} to reconnect...`);
//     setTimeout(() => {
//       connectToServer();
//     }, RECONNECT_INTERVAL);
//   } else {
//     console.log('Max reconnect attempts reached, giving up.');
//   }
// }

export class NrpClient {
  constructor(private settings: ClientSettings) {
    this.vhostClient = new VhostClient(this);
  }
  private nrpc: net.Socket | null = null;
  private vhostClient: VhostClient;
  private streamId = 1;
  private handleStream = new HandleStream();

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
    }, 10);
  }

  handleSettings = (frame: Frame, nrpc: net.Socket) => {
    if (frame.isSettings) {
      const setting = frame.decodePayload('utf-8', false);
      log.info(`receive settings, ${setting}`);
    }
  };

  start() {
    this.handleStream.register(this.handleSettings);
    this.handleStream.register(this.vhostClient.handleReqHeaders);
    this.handleStream.register(this.vhostClient.handleReqData);
    this.vhostClient.initSettings();
    const client = new net.Socket();
    client.connect(this.settings.bind_port, this.settings.bind_host, () => {
      log.info(`Connected to nrps ${this.settings.bind_host}:${this.settings.bind_port}`);
      // 发送数据到服务器
      client.write(
        new Frame(
          FrameType.SETTINGS,
          FrameFlag.PADDED,
          this.streamId,
          Buffer.from(JSON.stringify(this.settings), 'utf-8'),
        ).encode(),
      );

      this.nrpc = client;
    });
    // 当从服务器接收到数据时触发
    client.on('data', (data) => {
      this.handleStream.parse(data, client);
    });

    // 当连接关闭时触发
    client.on('close', () => {
      log.info('Connection closed');
      this.nrpc = null;
    });

    client.on('end', () => {
      log.info('Disconnected from server');
      // 服务器正常关闭连接，可能不需要重连
      // 如果需要在正常断开后也尝试重连，请在此处调用tryReconnect()
    });

    // 当发生错误时触发
    client.on('error', (err) => {
      log.error(err);
    });
    this.ping();
  }
}
