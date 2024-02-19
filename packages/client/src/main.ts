import * as net from 'net';
import { Buffer } from 'buffer';

import {
  allocateStreamId,
  ClientSettings,
  DEFAULT_PING_INTERVAL,
  Frame,
  FrameFlag,
  FrameType,
  HandleStream,
  NormalizedClientSettings,
  normalizeClientSettings,
  reconnectDelay,
} from '@nrpjs/shared';
import { VhostClient } from './manager/vhost';
import { log } from './logger';

export class NrpClient {
  private settings: NormalizedClientSettings;

  private nrpc: net.Socket | null = null;

  private activeSocket: net.Socket | null = null;

  private vhostClient: VhostClient;

  private handleStream = new HandleStream();

  private reconnectsUsed = 0;

  private stopped = false;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private connectTimer: NodeJS.Timeout | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;

  private streamCursor = { next: 1 };

  private localInFlight = new Set<number>();

  readonly connectAttemptAt: number[] = [];

  heartbeatWrites = 0;

  constructor(settings: ClientSettings) {
    const normalized = normalizeClientSettings(settings);
    if (!normalized.ok) {
      throw new Error(normalized.reason);
    }
    this.settings = normalized.settings;
    this.vhostClient = new VhostClient(this);
  }

  getStreamId() {
    const id = allocateStreamId(this.streamCursor, 2, 1, this.localInFlight);
    this.localInFlight.add(id);
    return id;
  }

  private releaseStreamId(id: number) {
    this.localInFlight.delete(id);
  }

  getSettings() {
    return this.settings;
  }

  hasHeartbeat() {
    return this.heartbeatTimer != null;
  }

  stop() {
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearConnectTimer();
    this.clearHeartbeat();
    const socket = this.activeSocket || this.nrpc;
    this.nrpc = null;
    this.activeSocket = null;
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  }

  handleSettings = (frame: Frame) => {
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
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    const interval = this.settings.ping_interval ?? DEFAULT_PING_INTERVAL;
    this.heartbeatTimer = setInterval(() => {
      const socket = this.nrpc;
      if (this.stopped || !socket || socket.destroyed || !socket.writable) {
        return;
      }
      const id = this.getStreamId();
      const frame = new Frame(FrameType.PING, FrameFlag.END_STREAM, id, Buffer.alloc(0)).encode();
      try {
        socket.write(frame, () => this.releaseStreamId(id));
        this.heartbeatWrites += 1;
      } catch (err) {
        this.releaseStreamId(id);
        log.error(err as Error);
      }
    }, interval);
  }

  private writeSettings(socket: net.Socket) {
    const id = this.getStreamId();
    try {
      socket.write(
        new Frame(
          FrameType.SETTINGS,
          FrameFlag.PADDED,
          id,
          Buffer.from(JSON.stringify(this.settings), 'utf-8'),
        ).encode(),
        () => this.releaseStreamId(id),
      );
    } catch (err) {
      this.releaseStreamId(id);
      log.error(err as Error);
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    if (this.reconnectsUsed >= this.settings.retry) {
      this.stopped = true;
      this.clearHeartbeat();
      this.clearConnectTimer();
      return;
    }
    const attempt = this.reconnectsUsed + 1;
    const delayMs = reconnectDelay(attempt, this.settings.backoff);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) {
        return;
      }
      this.reconnectsUsed = attempt;
      this.connect();
    }, delayMs);
  }

  private connect() {
    if (this.stopped) {
      return;
    }
    this.connectAttemptAt.push(Date.now());
    const socket = new net.Socket();
    this.activeSocket = socket;
    let settled = false;
    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      log.info('connect timeout');
      socket.destroy();
    }, this.settings.timeout);

    socket.connect(this.settings.bind_port, this.settings.bind_host, () => {
      if (settled || socket.destroyed || this.stopped) {
        if (!socket.destroyed) {
          socket.destroy();
        }
        return;
      }
      settled = true;
      this.clearConnectTimer();
      this.clearReconnectTimer();
      this.reconnectsUsed = 0;
      this.nrpc = socket;
      this.writeSettings(socket);
      this.startHeartbeat();
      log.info(`Connected to nrps ${this.settings.bind_host}:${this.settings.bind_port}`);
    });

    socket.on('data', (data) => {
      log.info('nrpc:data receive server chunk');
      try {
        this.handleStream.parse(data, socket);
      } catch (err) {
        log.error(err as Error);
        socket.destroy();
      }
    });

    socket.on('close', () => {
      log.info('nrpc:close Connection closed');
      this.clearConnectTimer();
      settled = true;
      if (this.nrpc === socket) {
        this.nrpc = null;
      }
      if (this.activeSocket === socket) {
        this.activeSocket = null;
      }
      this.clearHeartbeat();
      this.handleStream.drop(socket);
      this.scheduleReconnect();
    });

    socket.on('end', () => {
      log.info('nrpc:end Disconnected from server');
    });

    socket.on('error', (err) => {
      log.info('nrpc:error');
      log.error(err);
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
  }
}
