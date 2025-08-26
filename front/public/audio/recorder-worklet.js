// recorder-worklet.js
// 将输入声音累积到一定长度后，postMessage 回主线程。
// 缺省每 ~500ms 发一包（16kHz * 0.5s = 8000 样本）

class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const defaultLen = 16000 * 0.5; // 0.5s at 16kHz
    this._chunkLength = options?.processorOptions?.chunkLength ?? defaultLen;
    this._buffer = new Float32Array(0);

    // 可选：接收主线程消息（比如 flush/stop）
    this.port.onmessage = (event) => {
      const { type } = event.data || {};
      if (type === 'flush' && this._buffer.length > 0) {
        const chunk = this._buffer;
        this._buffer = new Float32Array(0);
        // 用可转移对象，避免拷贝
        this.port.postMessage(chunk, [chunk.buffer]);
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    // 累积到 _buffer
    const oldLen = this._buffer.length;
    const addLen = channel.length;
    const merged = new Float32Array(oldLen + addLen);
    merged.set(this._buffer, 0);
    merged.set(channel, oldLen);
    this._buffer = merged;

    // 足够长则切一块发回主线程
    while (this._buffer.length >= this._chunkLength) {
      const chunk = this._buffer.slice(0, this._chunkLength);
      this._buffer = this._buffer.slice(this._chunkLength);
      this.port.postMessage(chunk, [chunk.buffer]);
    }
    return true; // 返回 true 让处理持续
  }
}

registerProcessor('recorder-worklet', RecorderProcessor);
