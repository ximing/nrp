import { Buffer } from 'buffer';
import * as net from 'net';
import { Frame } from './frame';

export const FRAME_HEADER_LENGTH = 9;
export const MAX_FRAME_PAYLOAD_LENGTH = 1024 * 1024;

export class FrameTooLargeError extends Error {
  readonly declaredLength: number;

  constructor(declaredLength: number) {
    super(`frame payload ${declaredLength} exceeds ${MAX_FRAME_PAYLOAD_LENGTH}`);
    this.name = 'FrameTooLargeError';
    this.declaredLength = declaredLength;
  }
}

function readPayloadLength(header: Buffer): number {
  return (header.readUInt32BE(0) >> 8) & 0x00ffffff;
}

export class FrameReassembler {
  private buffer: Buffer = Buffer.alloc(0);

  get bufferedBytes(): number {
    return this.buffer.length;
  }

  push(data: Buffer): Frame[] {
    const frames: Frame[] = [];
    let offset = 0;
    while (true) {
      if (this.buffer.length < FRAME_HEADER_LENGTH) {
        const available = data.length - offset;
        if (available <= 0) {
          break;
        }
        const take = Math.min(FRAME_HEADER_LENGTH - this.buffer.length, available);
        this.append(data.subarray(offset, offset + take));
        offset += take;
        if (this.buffer.length < FRAME_HEADER_LENGTH) {
          break;
        }
      }

      const declared = readPayloadLength(this.buffer);
      if (declared > MAX_FRAME_PAYLOAD_LENGTH) {
        this.buffer = Buffer.alloc(0);
        throw new FrameTooLargeError(declared);
      }

      const total = FRAME_HEADER_LENGTH + declared;
      if (this.buffer.length < total) {
        const available = data.length - offset;
        if (available <= 0) {
          break;
        }
        const take = Math.min(total - this.buffer.length, available);
        this.append(data.subarray(offset, offset + take));
        offset += take;
        if (this.buffer.length < total) {
          break;
        }
      }

      const frame = Frame.decode(this.buffer.subarray(0, total));
      frames.push(frame);
      const rest = this.buffer.subarray(total);
      this.buffer = rest.length === 0 ? Buffer.alloc(0) : Buffer.from(rest);
    }
    return frames;
  }

  private append(chunk: Buffer) {
    if (chunk.length === 0) {
      return;
    }
    const nextLength = this.buffer.length + chunk.length;
    if (nextLength > MAX_FRAME_PAYLOAD_LENGTH + FRAME_HEADER_LENGTH) {
      this.buffer = Buffer.alloc(0);
      throw new FrameTooLargeError(nextLength);
    }
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
  }
}

export class HandleStream {
  private reassemblers = new Map<net.Socket, FrameReassembler>();

  private failed = new WeakSet<net.Socket>();

  private handleList: ((frame: Frame, socket: net.Socket) => void)[] = [];

  register(handle: (frame: Frame, socket: net.Socket) => void) {
    this.handleList.push(handle);
    return () => {
      this.handleList = this.handleList.filter((h) => h !== handle);
    };
  }

  bufferedBytes(socket: net.Socket): number {
    return this.reassemblers.get(socket)?.bufferedBytes ?? 0;
  }

  drop(socket: net.Socket) {
    this.reassemblers.delete(socket);
  }

  parse(data: Buffer, socket: net.Socket) {
    if (this.failed.has(socket)) {
      return;
    }
    let reassembler = this.reassemblers.get(socket);
    if (!reassembler) {
      reassembler = new FrameReassembler();
      this.reassemblers.set(socket, reassembler);
    }
    let frames: Frame[];
    try {
      frames = reassembler.push(data);
    } catch (err) {
      this.reassemblers.delete(socket);
      this.failed.add(socket);
      throw err;
    }
    for (const frame of frames) {
      for (const handle of this.handleList) {
        try {
          handle(frame, socket);
        } catch (err) {
          console.error(err);
        }
      }
    }
  }
}
