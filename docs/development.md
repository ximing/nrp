# 开发说明

使用者的安装、配置和访问方式在仓库根目录的 [README](../README.md)。这份文档只描述如何在本仓库里构建和修改 NRP。

## 环境

- Node.js 18
- pnpm 8.14.1（见根目录 `package.json` 的 `packageManager`）

## 安装、构建、测试

```bash
pnpm install
pnpm run build
pnpm test
```

`pnpm install` 会执行 `prepare`，也就是 `husky install`。

`pnpm run build` 清空各包的 `dist`，编译 `packages/*`，再把 `packages/web/dist` 同步到 `packages/dashboard/dist/web`。只编译除 web 以外的包可以用 `pnpm run build:dev`。

`pnpm test` 先编译 `@nrpjs/shared`、`@nrpjs/server` 和 `@nrpjs/client`，再用 Node 自带的测试运行器执行 `tests/*.test.js`。测试通过 `require('@nrpjs/...')` 调用编译后的入口。

本地还没有全局安装命令时，构建之后可以直接运行：

```bash
node packages/server/dist/bin.js -c app/demo/nrps.yaml
node packages/client/dist/bin.js -c app/demo/nrpc.yaml
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/shared` | 帧格式、按连接重组、配置校验、重连延迟、stream id |
| `packages/server` | 服务端 `nrps`：控制端口、客户端登记、虚拟主机 HTTP |
| `packages/client` | 客户端 `nrpc`：连接、心跳、重连、转发到本机端口 |
| `packages/panel` | 服务端和客户端共用的 React + TypeScript 控制面板，用 shadcn/ui 和 Tailwind 构建。`nrps` / `nrpc` 构建时把它的静态文件拷进自己的 `dist/panel` |
| `packages/dashboard`、`packages/web` | 旧的控制台页面和托管进程，命令行不再用它提供面板 |
| `app/demo` | 示例 HTTP 服务，以及一对 `nrps.yaml` / `nrpc.yaml` |
| `tests` | 帧边界、密钥与配置、重连、空闲超时和 stream id |
| `docs/config.md` | 配置字段表 |

发布到 npm 的包名是 `@nrpjs/server`、`@nrpjs/client` 和 `@nrpjs/shared`。命令名分别是 `nrps` 和 `nrpc`。

## 控制连接

客户端用 TCP 连接服务端的 `port`。一条消息由 9 字节头和载荷组成，载荷最长 1 MiB；超过这个长度的帧在头收齐时被拒绝。连接建立后客户端发送 SETTINGS。服务端核对 `secret` 和必填字段，通过后才把 `subdomain.subdomain_host` 登记到这条连接。

访问者打到 `vhost_http_port` 的请求按 Host 找到连接，服务端把请求帧发给客户端，客户端请求本机的 `local_port`，再把响应帧送回。连接关闭时，这条连接登记的主机和尚未写完的响应一并移除。

重连间隔、次数和连接超时来自客户端的 `backoff`、`retry` 和 `timeout`。服务端用 `idle_timeout` 关闭静默的控制连接。同一条连接上同时进行的响应使用不同的 stream id，并且 id 保持在 31 位以内。

## 提交说明

仓库历史里的提交主题使用 `feat:`、`fix:`、`docs:`、`test:` 这种普通前缀。`.cz-config.js` 里的类型带有 emoji 前缀。新提交沿用历史里的普通前缀；如果提交钩子因为主题拒绝，就改用钩子接受的主题。
