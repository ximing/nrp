## client

nrpc.yaml

```yaml
bind_port: 7000 # FRP 服务监听的端口
vhost_http_port: 8080 # HTTP 服务的虚拟主机端口
vhost_https_port: 4433 # HTTPS 服务的虚拟主机端口
subdomain_host: yourdomain.com # 你拥有的域名，用于子域名访问
timeout: 1000
retry: 3
backoff:
  min: 100
  max: 1000
  factor: 2
http:
  test:
    subdomain: test
    local_port: 3000
  test1:
    subdomain: test1
    local_port: 3001
```

## server

nrps.yaml

```yaml

```
