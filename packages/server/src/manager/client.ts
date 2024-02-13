import { NrpServer } from '../main';
import * as net from 'net';
import { ClientSettings } from '@nrpjs/shared';

export class ClientManager {
  private id = 0;

  constructor(private nrpServer: NrpServer) {}

  private get vHostManager() {
    return this.nrpServer.vhostManager;
  }

  private clientMap = new Map<number, net.Socket>();

  private clientMetaMap = new WeakMap<net.Socket, { id: number; settings: ClientSettings }>();

  setClient(nrpClient: net.Socket, settings: ClientSettings) {
    // TODO 校验 setting必填，非必填给默认值
    const id = ++this.id;
    this.clientMap.set(id, nrpClient);
    this.setMeta(nrpClient, {
      id,
      settings,
    });
    if (settings.http) {
      this.vHostManager.setVhost(settings.subdomain_host!, settings.http, nrpClient);
    }
    return id;
    // socket.write(configMessage, 'utf8', () => {
    //   console.log('配置信息已发送');
    // });
  }

  rmClient(id: number) {
    let socket = this.clientMap.get(id);
    if (socket) {
      this.vHostManager.rmVhost(socket);
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
