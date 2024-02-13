# Quick Start

## Install

```bash
npm i -g @nrpjs/server @nrpjs/client
```

## Usage

### Server

Provide the following `nrps.yaml` configuration on a server capable of providing external network access:

```yaml
port: 9000
vhost_http_port: 9001
```

```bash
nrps -c nrps.yaml
```

### Client

Provide the following `nrpc.yaml` configuration on the client machine that needs to be proxied:

```yaml
bind_port: 9000 # NRP 服务监听的端口
bind_host: 127.0.0.1 # NRP 服务监听的端口
subdomain_host: subdomain.com # 你拥有的域名，用于子域名访问
http:
  test:
    subdomain: demo
    local_port: 3000
```

```bash
nrpc -c nrpc.yaml
```
