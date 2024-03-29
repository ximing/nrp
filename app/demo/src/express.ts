import * as http from 'http';
import express from 'express';
import fs from 'fs';
import path from 'path';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);
const wsServer = new WebSocketServer({ clientTracking: false, noServer: true });
server.on('upgrade', function upgrade(request, socket, head) {
  wsServer.handleUpgrade(request, socket, head, function done(ws) {
    wsServer.emit('connection', ws, request);
  });
});
wsServer.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    console.log('Received message: %s', data);
  });
  // ws.send('You are connected to WebSocket server!');
});

const PORT = 5173;

// Middleware
app.use(express.json()); // bodyParser is now built into Express
app.use(morgan('dev')); // Using morgan for logging

// Root route
app.get('/', (req, res) => {
  res.send('Hello, Express with TypeScript!');
});

// File download route
app.get('/jmcj.txt', (req, res) => {
  const filePath = path.join(__dirname, '../jmcj.txt');
  const stat = fs.statSync(filePath);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Length', stat.size.toString());
  res.setHeader('Content-Disposition', 'attachment; filename=jmcj.txt');
  const readStream = fs.createReadStream(filePath);
  readStream.pipe(res);
});

app.get('/stream', async (req, res) => {
  let i = 0;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.write(
    '<!DOCTYPE html><html><head><title>Chunked Transfer Encoding Example</title></head><body>',
  );
  while (i++ < 20) {
    res.write(`<div>Chunk #${i}</div>`);
    await new Promise((resolve) => {
      setTimeout(() => resolve(true), 1000);
    });
  }
  res.write('</body></html>');
  res.end();
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
