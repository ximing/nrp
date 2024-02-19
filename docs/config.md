## client

nrpc.yaml

```yaml
bind_port: 7000 # FRP 服务监听的端口
bind_host: 127.0.0.1
vhost_http_port: 8080 # HTTP 服务的虚拟主机端口
vhost_https_port: 4433 # HTTPS 服务的虚拟主机端口
subdomain_host: yourdomain.com # 你拥有的域名，用于子域名访问
secret: your-shared-secret # 与服务端一致，否则不会注册虚拟主机
timeout: 1000 # 省略时默认 10000，连接尝试超时（毫秒）
retry: 3 # 省略时默认 3，初次连接失败或连接断开后的最大重连次数
backoff: # 省略时默认 min 100、max 1000、factor 2
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
port: 9000
vhost_http_port: 9001
secret: your-shared-secret # 与客户端一致
idle_timeout: 60000 # 省略时默认 60000，控制连接静默超时（毫秒）
```
