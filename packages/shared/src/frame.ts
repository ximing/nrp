import { Buffer } from 'buffer';

export enum FrameType {
  DATA = 0x0,
  HEADERS = 0x1,
  PRIORITY,
  RST_STREAM,
  SETTINGS,
  PUSH_PROMISE,
  PING,
  GOAWAY,
  WINDOW_UPDATE,
  CONTINUATION,
  WS_DATA,
  // 其他帧类型可以按需添加
}

export enum FrameFlag {
  END_DATA = 0x0,
  END_STREAM = 0x1, // ACK
  END_HEADERS = 0x4,
  PADDED = 0x8,
  PRIORITY = 0x20,
  // 其他标志可以按需添加
}

export class Frame {
  type: FrameType;
  flag: FrameFlag;
  streamId: number;
  payload: Buffer;

  constructor(type: FrameType, flag: FrameFlag, streamId: number, payload: Buffer) {
    this.type = type;
    this.flag = flag;
    this.streamId = streamId;
    this.payload = payload;
  }

  encode(): Buffer {
    const length = this.payload.length;
    const buffer = Buffer.alloc(9 + length); // 9字节头部 + 负载长度

    /*
     * buffer.writeUInt32BE((length & 0x00ffffff) << 8, 0); // 写入长度（24位） 3字节
     * 这行代码用于在缓冲区的开始处写入帧负载的长度。由于长度是24位的，这里首先使用length & 0x00ffffff将长度限制在24位内。然后，将结果左移8位（<< 8），是为了在32位空间内留出最高的8位（因为writeUInt32BE写入的是32位，即4字节）。这样，实际长度信息占据了从第二个字节到第四个字节的位置。writeUInt32BE是以大端字节序（BE - Big Endian）写入一个无符号的32位整数。
     * buffer.writeUInt8(this.type, 3); // 写入类型（8位） 1字节
     * 这行代码在缓冲区的第4个字节位置写入帧的类型。this.type是一个枚举值，代表了帧的类型（例如数据帧或头部帧）。writeUInt8方法用于写入一个无符号的8位整数，占用1个字节。
     * buffer.writeUInt8(this.flag, 4); // 写入标志（8位）1字节
     * 这行代码在缓冲区的第5个字节位置写入帧的标志（flag）。标志用于提供关于帧的附加信息，例如是否是最后一个帧或者头部是否结束等。与this.type类似，this.flags也是一个枚举值，writeUInt8同样写入一个无符号的8位整数。
     * buffer.writeUInt32BE(this.streamId & 0x7fffffff, 5); // 写入流ID（31位）
     * 这行代码在缓冲区的第6到第9个字节位置写入流ID。流ID是一个31位的值，用于标识属于同一个流的所有帧。这里使用this.streamId & 0x7fffffff确保只取流ID的最低31位（通过与0x7fffffff进行位与操作实现）。这是因为在某些协议中，最高位有特殊用途或需要保留。writeUInt32BE以大端格式写入这个31位的流ID。
     * */
    buffer.writeUInt32BE((length & 0x00ffffff) << 8, 0); // 写入长度（24位） 3字节
    buffer.writeUInt8(this.type, 3); // 写入类型（8位） 1字节
    buffer.writeUInt8(this.flag, 4); // 写入标志（8位）1字节
    buffer.writeUInt32BE(this.streamId & 0x7fffffff, 5); // 写入流ID（31位）4字节
    buffer.fill(this.payload, 9); // 写入负载
    return buffer;
  }

  static decode(buffer: Buffer): Frame {
    const length = (buffer.readUInt32BE(0) >> 8) & 0x00ffffff;
    const type = buffer.readUInt8(3);
    const flag = buffer.readUInt8(4);
    const streamId = buffer.readUInt32BE(5) & 0x7fffffff;
    const payload = buffer.slice(9, 9 + length);

    return new Frame(type as FrameType, flag as FrameFlag, streamId, payload);
  }

  get length() {
    return 9 + this.payload.length;
  }

  get isData() {
    return this.isHttpData || this.isWsData;
  }

  get isHeaders() {
    return this.type === FrameType.HEADERS;
  }

  get isSettings() {
    return this.type === FrameType.SETTINGS;
  }

  get isPing() {
    return this.type === FrameType.PING;
  }

  get isHttpData() {
    return this.type === FrameType.DATA;
  }

  get isWsData() {
    return this.type === FrameType.WS_DATA;
  }

  get isDataEnd() {
    return this.isData && Frame.checkFlag(this.flag, FrameFlag.END_DATA);
  }

  static checkFlag(curFlag: number, targetFlag: FrameFlag) {
    return curFlag === targetFlag;
  }

  static checkType(curType: number, targetType: FrameType) {
    return curType === targetType;
  }

  decodePayload(encode: BufferEncoding, isJson = false) {
    const payloadStr = this.payload.toString(encode);
    if (isJson) {
      return JSON.parse(payloadStr);
    }
    return payloadStr;
  }
}
