# NRP

NRP 把一台机器上的 HTTP 服务公布到另一台机器。能被外网访问的机器运行服务端 `nrps`，跑着网站或接口的机器运行客户端 `nrpc`。访问者请求服务端的 HTTP 端口，NRP 经控制连接把请求转到客户端配置的本机端口，再把响应送回去。

## 准备

两端使用 Node.js 18 或更高版本。

```bash
npm i -g @nrpjs/server
npm i -g @nrpjs/client
```

服务端命令是 `nrps`，客户端命令是 `nrpc`。两边都用 `-c` 指定一份 YAML 配置。`-h` 可以查看命令参数。

## 初始化配置

不想手写 YAML 时，在终端里运行：

```bash
nrps init
nrpc init
```

这是一个全屏表单。方向键移动，回车开始编辑，再按回车确认，Esc 放弃这一格。在「保存」上按回车写入。没有正在编辑时按 Esc 会取消，并且不创建文件。

`nrps init` 会询问控制端口、HTTP 端口、共享密钥、空闲超时，以及要不要启用控制面板。`nrpc init` 接着确认要公布的 HTTP 代理。列表里预先放了一条 `web` / `app` / `3000`，可以改、用 `x` 删除，或再添加。没有代理时不会写入。

默认写到当前目录的 `nrps.yaml` 和 `nrpc.yaml`。换路径：

```bash
nrps init -o /etc/nrp/nrps.yaml
nrpc init -o nrpc.yaml
```

路径也可以在表单最后一行修改。文件已经存在时，会问是否覆盖，光标默认停在「否」。

`init` 需要在终端里运行。写完后按提示启动，例如 `nrps -c nrps.yaml`。

## 启动服务端

在能被客户端和访问者连到的机器上保存 `nrps.yaml`：

```yaml
port: 9000
vhost_http_port: 9001
secret: your-shared-secret
```

```bash
nrps -c nrps.yaml
```

`port` 是客户端建立控制连接的端口。`vhost_http_port` 是访问者发送 HTTP 请求的端口。`secret` 必须和客户端写成同一个非空字符串，否则服务端不登记任何虚拟主机。

## 启动客户端

在本机服务旁边保存 `nrpc.yaml`。下面假设本机已经有程序监听 `3000`：

```yaml
bind_host: 203.0.113.10
bind_port: 9000
subdomain_host: example.com:9001
secret: your-shared-secret
http:
  web:
    subdomain: app
    local_port: 3000
```

`bind_host` 和 `bind_port` 指向服务端的控制端口。服务端和客户端在同一台机器上时，`bind_host` 写成 `127.0.0.1`。

```bash
nrpc -c nrpc.yaml
```

然后在浏览器打开：

```text
http://app.example.com:9001/
```

浏览器发出的 Host 是 `app.example.com:9001`。服务端按这个字符串查找虚拟主机，它等于 `subdomain`、一个点、再接上 `subdomain_host`。端口不是 80 时，把端口写进 `subdomain_host`，例如 `example.com:9001`。域名的 A 记录指向服务端机器。

还没有域名、只在本机确认链路时，可以直接请求 HTTP 端口并带上同样的 Host：

```bash
curl -H 'Host: app.example.com:9001' http://127.0.0.1:9001/
```

`http` 下面可以写多项，每一项有自己的 `subdomain` 和 `local_port`。键名（上面的 `web`）只在配置里区分条目。

## 控制面板

服务端和客户端各自有一份网页控制面板，跟命令打在一起，不需要另起前端开发服务。在对应的 YAML 里写上监听地址和 Basic 认证账号后，用浏览器打开该地址，按提示输入用户名和密码。

服务端示例：

```yaml
dashboard_addr: 127.0.0.1
dashboard_port: 7500
dashboard_user: admin
dashboard_pwd: change-me
```

打开 `http://127.0.0.1:7500/`。客户端用同一组字段，端口不要和服务端、控制端口、对外 HTTP 端口撞车，例如 `dashboard_port: 7501`。

`dashboard_user` 和 `dashboard_pwd` 是这一侧面板的唯一账号。没带认证、或账号密码不对时，页面和配置接口都返回 401，配置文件保持原样。通过认证后，服务端面板可以改服务端配置；客户端面板可以改客户端配置，并添加 HTTP 代理（子域名和本机端口）。保存会写回启动命令时的那份 YAML。重新启动对应命令后，新进程读到这些值。

省略 `dashboard_port` 时不启动面板。

## 配置

字段的简表也写在 [docs/config.md](docs/config.md)。

### 服务端

| 字段 | 说明 |
| --- | --- |
| `port` | 控制端口，客户端连接这里 |
| `vhost_http_port` | 对外的 HTTP 端口 |
| `secret` | 共享密钥。服务端未配置、客户端缺失，或两边不一致时，不登记虚拟主机 |
| `idle_timeout` | 可选，单位毫秒。控制连接在这段时间里没有任何数据就关闭。默认 `60000`。心跳也算数据 |
| `dashboard_addr` | 可选。控制面板监听地址，默认 `127.0.0.1` |
| `dashboard_port` | 可选。控制面板端口。设置后 `nrps` 才提供面板 |
| `dashboard_user` | 面板 Basic 认证用户名 |
| `dashboard_pwd` | 面板 Basic 认证密码 |

### 客户端

| 字段 | 说明 |
| --- | --- |
| `bind_host` | 服务端地址 |
| `bind_port` | 服务端控制端口，0 到 65535 的整数 |
| `secret` | 与服务端的 `secret` 相同 |
| `subdomain_host` | 和 `subdomain` 拼成对外主机名。访问时的 Host 必须是 `子域名.subdomain_host` |
| `http` | 至少一项 |
| `http.*.subdomain` | 子域名，不能为空 |
| `http.*.local_port` | 本机服务端口，0 到 65535 的整数 |
| `timeout` | 可选，单位毫秒。一次连接尝试最多等待这么久。默认 `10000` |
| `retry` | 可选。初次连接失败，或已经建立的连接断开之后，最多再连接这么多次。默认 `3`。次数用完后不再连接，也不再发送心跳 |
| `backoff.min` | 可选。第一次重连前的等待毫秒数。默认 `100` |
| `backoff.max` | 可选。等待时间的上限。默认 `1000` |
| `backoff.factor` | 可选。第 n 次重连前等待 `min(max, min × factorⁿ⁻¹)` 毫秒。默认 `2` |
| `ping_interval` | 可选，单位毫秒。向服务端发送心跳的间隔。默认 `10000` |
| `dashboard_addr` | 可选。控制面板监听地址，默认 `127.0.0.1` |
| `dashboard_port` | 可选。控制面板端口。设置后 `nrpc` 才提供面板 |
| `dashboard_user` | 面板 Basic 认证用户名 |
| `dashboard_pwd` | 面板 Basic 认证密码 |

连上服务端之后，重连计数清零。`ping_interval` 要小于服务端的 `idle_timeout`，这样心跳会落在空闲时限之内，连接可以保持。

`bind_port`、`bind_host` 缺失，`http` 里没有合法条目，或端口不是整数时，客户端启动即退出。这样的配置也不会在服务端留下路由。

某个子域名已经由一条仍可写的连接登记时，后到的连接保持原样，这条路由继续属于先到的连接。

密钥或配置被拒绝时，对这个主机的 HTTP 请求得到非成功状态，响应正文里没有本机服务的内容。

## 日志

运行日志打印在终端里。服务端同时写入当前目录的 `nrps.log`，客户端写入 `nrpc.log`。环境变量 `PINO_LOG_LEVEL` 调整级别，例如 `PINO_LOG_LEVEL=silent nrps -c nrps.yaml`。

## 仓库里的示例

`app/demo/nrps.yaml` 与 `app/demo/nrpc.yaml` 是一套对应配置：共享密钥为 `nrp-demo`，本机示例服务端口为 `5173`，对外主机名为 `nrpc.delu.life:9001`。服务端面板是 `http://127.0.0.1:7500/`，客户端面板是 `http://127.0.0.1:7501/`，用户名都是 `admin`，密码都是 `nrp-demo`。

修改和构建这个仓库见 [docs/development.md](docs/development.md)。许可证是 MIT，见 [LICENSE](LICENSE)。
