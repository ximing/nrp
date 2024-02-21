# 配置

使用步骤、访问时的 Host，以及一组可以直接复制的配置，写在仓库根目录的 [README](../README.md)。这里只列字段。

也可以在终端运行 `nrps init` 或 `nrpc init`，按提示生成下面的 YAML。`-o` 指定路径，默认是当前目录的 `nrps.yaml` 和 `nrpc.yaml`。目标文件已经存在时，要确认才会覆盖。

## 服务端 `nrps.yaml`

```yaml
port: 9000
vhost_http_port: 9001
secret: your-shared-secret
idle_timeout: 60000
dashboard_addr: 127.0.0.1
dashboard_port: 7500
dashboard_user: admin
dashboard_pwd: change-me
```

| 字段 | 是否必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `port` | 是 |  | 客户端连接的控制端口 |
| `vhost_http_port` | 是 |  | 访问者请求的 HTTP 端口 |
| `secret` | 是 |  | 非空共享密钥。缺失或与客户端不一致时不登记虚拟主机 |
| `idle_timeout` | 否 | `60000` | 控制连接静默这么多毫秒后关闭。心跳会重新计算这段时间 |
| `dashboard_addr` | 否 | `127.0.0.1` | 控制面板监听地址。设置了 `dashboard_port` 才启动 |
| `dashboard_port` | 否 |  | 控制面板自己的端口，与 `port`、`vhost_http_port` 分开 |
| `dashboard_user` | 启用面板时必填 |  | 面板 HTTP Basic 认证用户名 |
| `dashboard_pwd` | 启用面板时必填 |  | 面板 HTTP Basic 认证密码 |

## 客户端 `nrpc.yaml`

```yaml
bind_host: 203.0.113.10
bind_port: 9000
subdomain_host: example.com:9001
secret: your-shared-secret
timeout: 10000
retry: 3
backoff:
  min: 100
  max: 1000
  factor: 2
ping_interval: 10000
dashboard_addr: 127.0.0.1
dashboard_port: 7501
dashboard_user: admin
dashboard_pwd: change-me
http:
  web:
    subdomain: app
    local_port: 3000
```

| 字段 | 是否必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `bind_host` | 是 |  | 服务端地址 |
| `bind_port` | 是 |  | 服务端 `port`，0 到 65535 的整数 |
| `secret` | 是 |  | 与服务端 `secret` 相同 |
| `subdomain_host` | 是 |  | 对外主机名是 `subdomain.subdomain_host`，要和请求的 Host 完全一致。非 80 端口时把端口写在这里 |
| `http` | 是 |  | 至少一项。键名只用于区分条目 |
| `http.*.subdomain` | 是 |  | 非空子域名 |
| `http.*.local_port` | 是 |  | 本机服务端口，0 到 65535 的整数 |
| `timeout` | 否 | `10000` | 一次连接尝试的超时，毫秒 |
| `retry` | 否 | `3` | 初次连接失败或连接断开后，最多再连接的次数。用尽后停止连接和心跳 |
| `backoff.min` | 否 | `100` | 第一次重连前的等待，毫秒 |
| `backoff.max` | 否 | `1000` | 等待上限，毫秒 |
| `backoff.factor` | 否 | `2` | 第 n 次重连前等待 `min(max, min × factorⁿ⁻¹)` 毫秒 |
| `ping_interval` | 否 | `10000` | 心跳间隔，毫秒。应小于服务端 `idle_timeout` |
| `dashboard_addr` | 否 | `127.0.0.1` | 客户端控制面板监听地址 |
| `dashboard_port` | 否 |  | 客户端控制面板端口，与服务端面板、`bind_port` 分开 |
| `dashboard_user` | 启用面板时必填 |  | 面板 HTTP Basic 认证用户名 |
| `dashboard_pwd` | 启用面板时必填 |  | 面板 HTTP Basic 认证密码 |

连接成功后重连计数清零。省略 `timeout`、`retry`、`backoff` 或 `ping_interval` 时使用上表的默认值。

缺少 `bind_host`、`bind_port` 或合法的 `http` 条目，或端口不是整数时，客户端退出，服务端不创建路由。一条仍可写的连接已经登记某个子域名时，后到的连接不会替换它。

控制面板的四个 `dashboard_*` 字段两边相同。浏览器打开 `http://dashboard_addr:dashboard_port/`，用该侧的 `dashboard_user` 和 `dashboard_pwd` 做 Basic 认证。未认证或密码错误得到 401，配置文件不变。认证通过后，服务端面板改服务端字段；客户端面板改客户端字段，并用子域名加本机端口新增 `http` 代理。写入的是命令启动时的 YAML，下次启动时加载。
