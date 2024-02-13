import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import path from 'node:path';
import * as fs from 'fs';

const app = new Koa();
const router = new Router();

const logger = require('koa-logger')

app.use(bodyParser());
app.use(logger())

// 定义一个简单的路由：响应根路径请求
router.get('/', async (ctx) => {
  ctx.body = 'Hello, Koa with TypeScript!';
});

// 文件下载路由
router.get('/jmcj.txt', async (ctx) => {
  const filePath = path.join(__dirname, '../jmcj.txt');
  const stat = fs.statSync(filePath);
  ctx.response.set('Content-Type', 'text/plain');
  ctx.response.set('Content-Length', stat.size.toString());
  ctx.response.set('Content-Disposition', 'attachment; filename=jmcj.txt');
  ctx.body = fs.createReadStream(filePath);
});

// 使用路由中间件
app.use(router.routes()).use(router.allowedMethods());

// 启动服务器
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
