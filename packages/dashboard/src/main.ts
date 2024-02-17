import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as path from 'path';

const app = express();
const PORT = 3000;

// 配置API代理
const apiProxy = createProxyMiddleware('/api', {
  target: 'http://远端服务的地址', // 请将这里替换为你的远端服务地址
  changeOrigin: true,
  pathRewrite: { '^/api': '' }, // 如果远端服务不需要`/api`前缀，可以使用pathRewrite来重写路径
});

// 使用API代理中间件
app.use('/api', apiProxy);

// 对于任何非API请求，返回`dist/index.html`
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.resolve(__dirname, 'dist/index.html'));
  } else {
    next();
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
