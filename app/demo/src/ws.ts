import WebSocket from 'ws';

// const ws = new WebSocket('ws://nrpc.delu.life:9001/');
const ws = new WebSocket('ws://127.0.0.1:5173/', 'vite-hmr', {
  // perMessageDeflate: false,
  headers: {
    connection: 'Upgrade',
    pragma: 'no-cache',
    'cache-control': 'no-cache',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    upgrade: 'websocket',
    origin: 'http://nrpc.delu.life:9001',
    'accept-encoding': 'gzip, deflate',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6',
    cookie:
      'WEBDFPID=1706540629702EOISWIM75613c134b6a252faa6802015be905513060-1706540629702-1706540629702EOISWIM75613c134b6a252faa6802015be905513060; _lxsdk_cuid=18d55bf7eedc8-03ef3e88657a3a-1e525637-1d73c0-18d55bf7eed6f',
    'sec-websocket-version': '13',
    'sec-websocket-key': '1SSyhVJTaxzTDDYaK/vMaA==',
    'sec-websocket-extensions': 'permessage-deflate; client_max_window_bits',
    'Sec-Websocket-Protocol': 'vite-hmr',
  },
});

ws.on('error', console.error);

ws.on('open', function open() {
  console.log('open');
  const array = new Float32Array(5);

  for (var i = 0; i < array.length; ++i) {
    array[i] = i / 2;
  }

  ws.send(array);
});

ws.on('close', function close(event) {
  console.log(`Connection closed, Code: ${event}`);
});

ws.on('message', (data) => {
  console.log(data);
});
