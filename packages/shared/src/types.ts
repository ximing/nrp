export interface ClientHttpSetting {
  [key: string]: {
    subdomain: string;
    local_port: number;
  };
}
export interface ClientSettings {
  bind_port: number;
  bind_host: string;
  subdomain_host?: string;
  timeout?: number;
  retry?: number;
  backoff?: {
    min: number;
    max: number;
    factor: number;
  };
  http: ClientHttpSetting;
}

export interface NrpServerConfig {
  port: number;
  vhost_http_port: number;
  vhost_https_port?: number;
}
