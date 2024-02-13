import { Buffer } from 'buffer';
import { Frame } from './frame';
import * as net from 'net';

export class HandleStream {
  private remainingBuffer = Buffer.alloc(0);

  private handleList: ((frame: Frame, socket: net.Socket) => void)[] = [];

  register(handle: (frame: Frame, socket: net.Socket) => void) {
    this.handleList.push(handle);
    return () => {
      this.handleList = this.handleList.filter((h) => h !== handle);
    };
  }

  parse(data: Buffer, socket: net.Socket) {
    this.remainingBuffer = Buffer.concat([this.remainingBuffer, data]);
    // 尝试从拼接后的缓冲区中解析帧
    let frame = this.tryParseFrame();
    while (frame) {
      // 成功解析一个帧，处理该帧
      for (let handle of this.handleList) {
        try {
          handle(frame, socket);
        } catch (err) {
          console.error(err);
        }
      }
      // 从缓冲区中移除已经解析的帧数据
      this.remainingBuffer = this.remainingBuffer.subarray(frame.length);
      // 尝试解析下一个帧
      frame = this.tryParseFrame();
    }
  }

  private tryParseFrame() {
    const buffer = this.remainingBuffer;
    if (buffer.length < 9) {
      // 缓冲区中的数据不足以解析出帧头，需要更多的数据
      return null;
    }

    const length = (buffer.readUInt32BE(0) >> 8) & 0x00ffffff; // 读取长度
    if (buffer.length < 9 + length) {
      // 缓冲区中的数据不足以解析出完整的帧，需要更多的数据
      return null;
    }

    // 缓冲区中有足够的数据，可以解析出一个完整的帧
    return Frame.decode(buffer.subarray(0, 9 + length));
  }
}
