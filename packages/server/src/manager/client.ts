import { NrpServer } from '../main';
import * as net from 'net';
import { authorizeClientSettings, ClientSettings } from '@nrpjs/shared';
import { log } from '../logger';

export class ClientManager {
  private id = 0;

  constructor(private nrpServer: NrpServer) {}

  private get vHostManager() {
    return this.nrpServer.vhostManager;
  }

  private clientMap = new Map<number, net.Socket>();

  private clientMetaMap = new WeakMap<net.Socket, { id: number; settings: ClientSettings }>();

  setClient(nrpClient: net.Socket, settings: unknown): number | null {
    const auth = authorizeClientSettings(settings, this.nrpServer.getConfig().secret);
    if (!auth.ok) {
      log.warn(`reject settings: ${auth.reason}`);
      return null;
    }
    const normalized: ClientSettings = auth.settings;
    const id = ++this.id;
    this.clientMap.set(id, nrpClient);
    this.setMeta(nrpClient, {
      id,
      settings: normalized,
    });
    this.vHostManager.setVhost(normalized.subdomain_host ?? '', normalized.http, nrpClient);
    return id;
    // socket.write(configMessage, 'utf8', () => {
    //   console.log('配置信息已发送');
    // });
  }

  rmClient(id: number) {
    const socket = this.clientMap.get(id);
    if (socket) {
      this.vHostManager.releaseSocket(socket);
      this.clientMap.delete(id);
    }
  }

  setMeta(nrpClient: net.Socket, meta: any) {
    this.clientMetaMap.set(nrpClient, meta);
  }

  getMeta(nrpClient: net.Socket) {
    return this.clientMetaMap.get(nrpClient);
  }

  rmMeta(nrpClient: net.Socket) {
    return this.clientMetaMap.delete(nrpClient);
  }
}
