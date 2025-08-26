// Voice Service for Real-time Voice Communication
// This service handles WebSocket connections to the backend for voice interactions

export interface VoiceMessage {
  type: 'audio_chunk' | 'audio_end' | 'text_message' | 'form_update' | 'role_change' | 'function_call' | 'transcript' | 'error';
  audio?: string; // base64 encoded audio
  text?: string;
  form_data?: Record<string, any>;
  ai_role?: string;
  data?: any;
  message?: string;
}

export interface VoiceCallbacks {
  onAudioReceived?: (audioData: Uint8Array) => void;
  onFunctionCall?: (data: { reply: string; updates: Array<{ field: string; suggestion: string }> }) => void;
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  onPlayingStateChange?: (isPlaying: boolean) => void;
}

export class VoiceService {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private callbacks: VoiceCallbacks = {};
  private clientId: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second

  // Audio recording properties
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private isRecording = false;

  // Audio playback properties
  private audioContext: AudioContext | null = null;
  private isPlaying = false;
  private audioPlaybackQueue: Uint8Array[] = [];
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private currentHtmlAudio: HTMLAudioElement | null = null;
  private playbackSessionId = 0;

  // Web Audio API for direct PCM capture
  private audioWorkletNode: AudioWorkletNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private audioBuffer: Float32Array[] = [];
  private bufferSampleCount = 0;
  
  // For one-time recording mode
  private recordingMode: 'streaming' | 'batch' = 'batch';
  private recordedAudioChunks: Float32Array[] = [];

  constructor(clientId: string = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`) {
    this.clientId = clientId;
  }

  /**
   * Set callbacks for handling voice events
   */
  setCallbacks(callbacks: VoiceCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Connect to the voice WebSocket
   */
  async connect(): Promise<boolean> {
    if (this.isConnected) {
      return true;
    }

    try {
      const wsUrl = this.getWebSocketUrl();
      console.log(`[VoiceService] Connecting to: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('[VoiceService] WebSocket connected to:', wsUrl);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.callbacks.onConnectionChange?.(true);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        console.log('[VoiceService] WebSocket closed. Code:', event.code, 'Reason:', event.reason, 'Was clean:', event.wasClean);
        this.isConnected = false;
        this.callbacks.onConnectionChange?.(false);
        
        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log('[VoiceService] Scheduling reconnect attempt...');
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[VoiceService] WebSocket error:', error);
        console.error('[VoiceService] WebSocket state:', this.ws?.readyState);
        console.error('[VoiceService] WebSocket URL:', wsUrl);
        this.callbacks.onError?.('WebSocket connection error');
      };

      // Wait for connection to establish
      return new Promise((resolve) => {
        const checkConnection = () => {
          if (this.isConnected) {
            resolve(true);
          } else if (this.ws?.readyState === WebSocket.CLOSED) {
            resolve(false);
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });

    } catch (error) {
      console.error('[VoiceService] Connection error:', error);
      this.callbacks.onError?.(`Connection failed: ${error}`);
      return false;
    }
  }

  /**
   * Disconnect from the voice WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'User initiated disconnect');
      this.ws = null;
    }
    
    this.stopRecording();
    this.stopPlayback();
    
    // Close audio context when disconnecting completely
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        console.warn('[VoiceService] Error closing audio context:', e);
      }
      this.audioContext = null;
    }
    
    this.isConnected = false;
    this.callbacks.onConnectionChange?.(false);
  }

  /**
   * Start recording audio from microphone
   */
  async startRecording(): Promise<boolean> {
    if (this.isRecording) {
      return true;
    }

    // Stop any ongoing audio playback to avoid overlap
    console.log('[VoiceService] Stopping audio playback before starting recording...');
    this.stopPlayback();

    try {
      // Request microphone access with optimized settings for better speech recognition
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000, // 降低到16kHz，Whisper推荐采样率
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true, // 启用噪音抑制
          autoGainControl: true   // 启用自动增益控制
        }
      });

      // Initialize audio context if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000 // 匹配麦克风采样率
        });
      }

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Use AudioWorkletNode for modern audio processing
      try {
        // 1) 注册 worklet 模块
        await this.audioContext.audioWorklet.addModule(
          `${import.meta.env.BASE_URL}audio/recorder-worklet.js`
        );
        
        // 2) 创建 AudioWorkletNode
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'recorder-worklet', {
          numberOfInputs: 1,
          numberOfOutputs: 0, // 我们只采集，不输出音频
          channelCount: 1,
          processorOptions: {
            chunkLength: Math.floor(16000 * 0.5), // 约 500ms 一包，增加缓冲时间
          },
        });

        // 3) 创建 MediaStream 源并连接到 worklet
        this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.audioStream!);
        this.mediaStreamSource.connect(this.audioWorkletNode);

        // 4) 接收 worklet 回来的 Float32Array 音频数据
        this.audioWorkletNode.port.onmessage = (event: MessageEvent) => {
          if (!this.isRecording) return;
          
          const floatChunk = event.data as Float32Array;
          if (floatChunk && floatChunk.length > 0) {
            // 调试：检查音频数据
            const maxAmplitude = Math.max(...Array.from(floatChunk).map(Math.abs));
            const avgAmplitude = Array.from(floatChunk).reduce((sum, val) => sum + Math.abs(val), 0) / floatChunk.length;
            console.log(`[VoiceService] Audio chunk received: length=${floatChunk.length}, maxAmplitude=${maxAmplitude.toFixed(4)}, avgAmplitude=${avgAmplitude.toFixed(4)}`);
            
            // 复用现有的累计逻辑
            this.accumulateAudioData(floatChunk);
          }
        };

        console.log('[VoiceService] Using AudioWorkletNode for recording');
      } catch (workletError) {
        console.error('[VoiceService] Failed to initialize AudioWorkletNode:', workletError);
        this.callbacks.onError?.(`Audio recording initialization failed: ${workletError}`);
        return false;
      }

      this.isRecording = true;
      this.callbacks.onRecordingStateChange?.(true);
      console.log('[VoiceService] Recording started with Web Audio API');
      return true;

    } catch (error) {
      console.error('[VoiceService] Recording error:', error);
      this.callbacks.onError?.(`Recording failed: ${error}`);
      return false;
    }
  }

  /**
   * Stop recording audio
   */
  stopRecording() {
    if (!this.isRecording) {
      console.log('[VoiceService] Stop recording called but not currently recording');
      return;
    }

    console.log('[VoiceService] Stopping recording...');
    
    // Set recording to false first to prevent new data accumulation
    this.isRecording = false;
    this.callbacks.onRecordingStateChange?.(false);

    try {
      if (this.recordingMode === 'batch') {
        // In batch mode, send all recorded audio as one message
        console.log(`[VoiceService] Processing ${this.recordedAudioChunks.length} recorded chunks`);
        this.sendBatchAudio();
      } else {
        // In streaming mode, use original logic
        this.flushAudioBuffer();
        this.sendMessage({ type: 'audio_end' });
      }
    } catch (error) {
      console.error('[VoiceService] Error processing recorded audio:', error);
      this.callbacks.onError?.(`Failed to process recording: ${error}`);
    }

    // Clean up audio resources
    // 停止前把残留缓冲冲刷出来（可选）
    try {
      this.audioWorkletNode?.port.postMessage({ type: 'flush' });
    } catch (e) {
      console.warn('[VoiceService] Error flushing worklet buffer:', e);
    }

    try {
      if (this.mediaStreamSource && this.audioWorkletNode) {
        this.mediaStreamSource.disconnect(this.audioWorkletNode);
      }
    } catch (e) {
      console.warn('[VoiceService] Error disconnecting media stream source:', e);
    }
    this.mediaStreamSource = null;

    try {
      if (this.audioWorkletNode) {
        this.audioWorkletNode.port.onmessage = null;
        this.audioWorkletNode.disconnect();
      }
    } catch (e) {
      console.warn('[VoiceService] Error disconnecting audio worklet node:', e);
    }
    this.audioWorkletNode = null;

    if (this.mediaRecorder) {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn('[VoiceService] Error stopping media recorder:', e);
      }
      this.mediaRecorder = null;
    }

    if (this.audioStream) {
      try {
        this.audioStream.getTracks().forEach(track => track.stop());
      } catch (e) {
        console.warn('[VoiceService] Error stopping audio tracks:', e);
      }
      this.audioStream = null;
    }
    
    // Clear buffers
    this.audioBuffer = [];
    this.bufferSampleCount = 0;
    this.recordedAudioChunks = [];
    
    console.log('[VoiceService] Recording stopped and resources cleaned up');
  }

  /**
   * Send text message to voice AI
   */
  sendTextMessage(text: string) {
    this.sendMessage({
      type: 'text_message',
      text
    });
  }

  /**
   * Update form context
   */
  updateFormContext(formData: Record<string, any>) {
    this.sendMessage({
      type: 'form_update',
      form_data: formData
    });
  }

  /**
   * Change AI role
   */
  changeRole(aiRole: string) {
    this.sendMessage({
      type: 'role_change',
      ai_role: aiRole
    });
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Check if currently playing audio
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Manually stop audio playback
   */
  stopAudioPlayback(): void {
    this.stopPlayback();
  }

  /**
   * Force stop ALL audio immediately (brute force):
   * - stop current sources
   * - clear queues
   * - close AudioContext
   * - bump playback session so any pending timers are ignored
   */
  stopAllAudioNow(): void {
    console.log('[VoiceService] HARD STOP: stopping all audio now');
    // Invalidate any pending playback timers
    this.playbackSessionId++;
    // Stop current sources and clear queue/state
    this.stopPlayback();
    // Close audio context to ensure no residual sound
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        console.warn('[VoiceService] Error closing audio context in hard stop:', e);
      }
    }
    this.audioContext = null;
    this.isPlaying = false;
    this.callbacks.onPlayingStateChange?.(false);
  }

  // Private methods



  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = 'localhost'; // 确保连接到正确的主机
    const port = '8000'; // 后端固定端口
    return `${protocol}//${host}:${port}/voice/${this.clientId}`;
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`[VoiceService] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      if (!this.isConnected && this.reconnectAttempts <= this.maxReconnectAttempts) {
        console.log(`[VoiceService] Reconnect attempt ${this.reconnectAttempts}`);
        this.connect();
      }
    }, delay);
  }

  private sendMessage(message: VoiceMessage) {
    if (this.ws && this.isConnected) {
      console.log('[VoiceService] Sending message:', message.type, message.type === 'text_message' ? message.text?.substring(0, 100) + '...' : '');
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[VoiceService] Cannot send message - not connected. Message type:', message.type);
    }
  }

  private handleMessage(data: string) {
    try {
      const message: VoiceMessage = JSON.parse(data);
      console.log('[VoiceService] Received message:', message.type, 'Full message:', message);

      switch (message.type) {
        case 'audio_chunk':
          console.log('[VoiceService] Audio chunk received:', message.audio ? message.audio.length : 0, 'chars');
          if (message.audio) {
            const audioData = Uint8Array.from(atob(message.audio), c => c.charCodeAt(0));
            console.log('[VoiceService] Playing audio chunk:', audioData.length, 'bytes');
            
            // HARD STOP before starting new playback to avoid overlaps
            this.stopAllAudioNow();
            
            // Check if this is MP3 format (from chained architecture)
            let format = (message as any).format || 'auto';
            if (format === 'auto') {
              // Sniff first bytes for MP3 frame header or ID3 tag
              const v = audioData;
              const looksMp3 = v.length >= 3 && (
                (v[0] === 0xFF && (v[1] & 0xE0) === 0xE0) ||
                (v[0] === 0x49 && v[1] === 0x44 && v[2] === 0x33)
              );
              format = looksMp3 ? 'mp3' : 'pcm16';
            }
            if (format === 'mp3') {
              this.playMP3Audio(audioData);
            } else {
              this.playAudioChunk(audioData);
            }
            
            // Call the callback for UI updates
            if (this.callbacks.onAudioReceived) {
              this.callbacks.onAudioReceived(audioData);
            }
          }
          break;

        case 'function_call':
          console.log('[VoiceService] Function call received:', message.data);
          if (message.data && this.callbacks.onFunctionCall) {
            this.callbacks.onFunctionCall(message.data);
          }
          break;

        case 'transcript':
          console.log('[VoiceService] Transcript received:', message.text);
          if (message.text && this.callbacks.onTranscript) {
            this.callbacks.onTranscript(message.text);
          }
          break;

        case 'error':
          console.error('[VoiceService] Error message received:', message.message);
          if (message.message && this.callbacks.onError) {
            this.callbacks.onError(message.message);
          }
          break;

        default:
          console.log('[VoiceService] Unknown message type:', message.type, 'Full message:', message);
      }

    } catch (error) {
      console.error('[VoiceService] Message parsing error:', error, 'Raw data:', data);
    }
  }

  private accumulateAudioData(floatData: Float32Array) {
    // Copy the data to avoid reference issues
    const dataCopy = new Float32Array(floatData);
    
    // Check for silent audio with improved threshold (higher to avoid false positives)
    const maxAmplitude = Math.max(...Array.from(dataCopy).map(Math.abs));
    const isSilent = maxAmplitude < 0.01; // 提高阈值到0.01，减少误判
    
    if (this.recordingMode === 'batch') {
      // In batch mode, accumulate all data (including silence for timing)
      this.recordedAudioChunks.push(dataCopy);
      
      // Debug: Log accumulation info
      const totalSamples = this.recordedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (this.recordedAudioChunks.length % 20 === 0) { // Log every 20 chunks
        console.log(`[VoiceService] Accumulated ${this.recordedAudioChunks.length} chunks, ${totalSamples} samples (${(totalSamples / 16000).toFixed(2)}s), silent: ${isSilent ? 'yes' : 'no'}, maxAmplitude: ${maxAmplitude.toFixed(4)}`);
      }
      
      // 调试：检查第一个和最后一个chunk的数据
      if (this.recordedAudioChunks.length === 1) {
        const firstChunk = this.recordedAudioChunks[0];
        const firstMax = Math.max(...Array.from(firstChunk).map(Math.abs));
        const firstAvg = Array.from(firstChunk).reduce((sum, val) => sum + Math.abs(val), 0) / firstChunk.length;
        console.log(`[VoiceService] First chunk: length=${firstChunk.length}, maxAmplitude=${firstMax.toFixed(4)}, avgAmplitude=${firstAvg.toFixed(4)}`);
      }
    } else {
      // In streaming mode, use original logic
      this.audioBuffer.push(dataCopy);
      this.bufferSampleCount += dataCopy.length;
      
      // Send chunks more frequently to avoid buffer too small errors
      // Send every ~500ms (was 300ms) and ensure minimum 300ms buffer
      if (this.bufferSampleCount >= 16000 * 0.5) { // 0.5 seconds at 16kHz
        this.sendBufferedAudio();
      }
    }
  }

  private sendBatchAudio() {
    if (this.recordedAudioChunks.length === 0) {
      console.log('[VoiceService] No audio chunks to send');
      return;
    }
    
    try {
      // Calculate total samples
      const totalSamples = this.recordedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const durationSeconds = totalSamples / 16000; // 使用16kHz采样率
      
      // 重要：验证录音质量和长度
      if (durationSeconds < 0.5) {
        console.warn(`[VoiceService] Recording too short (${durationSeconds.toFixed(2)}s), minimum 0.5s required`);
        this.callbacks.onError?.('录音时间太短，请至少录制0.5秒');
        return;
      }
      
      // 检查音频是否有实际内容（不是纯静音）
      let hasAudioContent = false;
      let totalAmplitude = 0;
      let sampleCount = 0;
      
      for (const chunk of this.recordedAudioChunks) {
        for (let i = 0; i < chunk.length; i++) {
          totalAmplitude += Math.abs(chunk[i]);
          sampleCount++;
        }
      }
      
      const averageAmplitude = totalAmplitude / sampleCount;
      hasAudioContent = averageAmplitude > 0.005; // 平均振幅阈值
      
      if (!hasAudioContent) {
        console.warn(`[VoiceService] No audio content detected (average amplitude: ${averageAmplitude.toFixed(4)})`);
        this.callbacks.onError?.('未检测到有效音频内容，请重新录制');
        return;
      }
      
      console.log(`[VoiceService] Audio quality check passed: duration=${durationSeconds.toFixed(2)}s, avgAmplitude=${averageAmplitude.toFixed(4)}`);
      
      // Check if recording is too long (limit to 60 seconds)
      if (durationSeconds > 60) {
        console.warn(`[VoiceService] Recording too long (${durationSeconds.toFixed(2)}s), truncating to 60s`);
        const maxSamples = 16000 * 60; // 60 seconds at 16kHz
        const truncatedChunks = [];
        let currentSamples = 0;
        
        for (const chunk of this.recordedAudioChunks) {
          if (currentSamples + chunk.length <= maxSamples) {
            truncatedChunks.push(chunk);
            currentSamples += chunk.length;
          } else {
            // Add partial chunk if needed
            const remainingSamples = maxSamples - currentSamples;
            if (remainingSamples > 0) {
              truncatedChunks.push(chunk.slice(0, remainingSamples));
            }
            break;
          }
        }
        this.recordedAudioChunks = truncatedChunks;
      }
      
      // Combine all recorded audio more efficiently
      const finalSamples = this.recordedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      console.log(`[VoiceService] Combining ${this.recordedAudioChunks.length} chunks into ${finalSamples} samples`);
      
      const combinedBuffer = new Float32Array(finalSamples);
      let offset = 0;
      
      for (let i = 0; i < this.recordedAudioChunks.length; i++) {
        const chunk = this.recordedAudioChunks[i];
        combinedBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Convert to PCM16 and encode
      const pcm16Buffer = this.convertToPCM16(combinedBuffer);
      
      // 调试：检查PCM16数据
      console.log(`[VoiceService] PCM16 buffer: length=${pcm16Buffer.length}, first 10 values:`, Array.from(pcm16Buffer.slice(0, 10)));
      
      // 检查是否全是零值
      const allZeros = pcm16Buffer.every(byte => byte === 0);
      if (allZeros) {
        console.error('[VoiceService] ERROR: PCM16 buffer contains only zeros! This indicates a recording problem.');
        this.callbacks.onError?.('录音数据异常，请检查麦克风权限和设置');
        return;
      }
      
      // 检查是否有非零值
      const nonZeroCount = Array.from(pcm16Buffer).filter(byte => byte !== 0).length;
      console.log(`[VoiceService] PCM16 buffer: ${nonZeroCount}/${pcm16Buffer.length} non-zero bytes`);
      
      if (nonZeroCount === 0) {
        console.error('[VoiceService] ERROR: No non-zero audio data detected!');
        this.callbacks.onError?.('未检测到有效音频数据，请重新录制');
        return;
      }
      
      // Convert to base64 safely to avoid call stack overflow
      // First, convert all bytes to a single string
      let allBytesString = '';
      const subChunkSize = 1000; // Small chunks for String.fromCharCode
      for (let i = 0; i < pcm16Buffer.length; i += subChunkSize) {
        const subChunk = pcm16Buffer.slice(i, i + subChunkSize);
        allBytesString += String.fromCharCode.apply(null, Array.from(subChunk));
      }
      
      // 调试：检查字符串转换
      console.log(`[VoiceService] String conversion: length=${allBytesString.length}, first 50 chars:`, allBytesString.substring(0, 50));
      
      // Then encode the entire string to base64
      const audioB64 = btoa(allBytesString);
      
      // 调试：检查base64结果
      console.log(`[VoiceService] Base64 result: length=${audioB64.length}, first 50 chars:`, audioB64.substring(0, 50));
      
      // Send as text message with the recorded audio content
      console.log(`[VoiceService] Sending batch audio: ${finalSamples} samples (${(finalSamples / 16000).toFixed(2)}s), base64 length: ${audioB64.length}`);
      
      // Send the audio as a text message for transcription
      console.log('[VoiceService] Sending batch audio to backend via text message');
      this.sendMessage({
        type: 'text_message',
        text: `[VOICE_AUDIO_BASE64]${audioB64}`
      });
      
    } catch (error) {
      console.error('[VoiceService] Error sending batch audio:', error);
      this.callbacks.onError?.(`Failed to send audio: ${error}`);
    }
  }

  private sendBufferedAudio() {
    if (this.audioBuffer.length === 0) return;
    
    try {
      // Combine all buffered audio
      const totalSamples = this.bufferSampleCount;
      const combinedData = new Float32Array(totalSamples);
      
      let offset = 0;
      for (const chunk of this.audioBuffer) {
        combinedData.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Convert to PCM16
      const pcmData = this.convertToPCM16(combinedData);
      
      // Convert to base64 for transmission
      const base64 = btoa(String.fromCharCode(...pcmData));
      
      // Send to backend
      this.sendMessage({
        type: 'audio_chunk',
        audio: base64
      });

      console.log('[VoiceService] Sent accumulated PCM chunk:', pcmData.length, 'bytes', `(${(totalSamples / 16000).toFixed(2)}s)`);
      
      // Clear buffer after sending
      this.audioBuffer = [];
      this.bufferSampleCount = 0;

    } catch (error) {
      console.error('[VoiceService] PCM processing error:', error);
    }
  }

  private flushAudioBuffer() {
    if (this.audioBuffer.length === 0) {
      console.log('[VoiceService] No audio data to flush');
      return;
    }
    
    // Only flush if we have sufficient audio data (minimum 300ms)
    const totalDuration = this.bufferSampleCount / 16000;
    if (totalDuration < 0.3) {
      console.log(`[VoiceService] Buffer too short (${totalDuration.toFixed(2)}s), not flushing to avoid OpenAI error`);
      // Clear insufficient buffer
      this.audioBuffer = [];
      this.bufferSampleCount = 0;
      return;
    }
    
    console.log(`[VoiceService] Flushing final audio buffer (${totalDuration.toFixed(2)}s)...`);
    this.sendBufferedAudio();
  }

  private convertToPCM16(floatData: Float32Array): Uint8Array {
    // Convert float32 samples to 16-bit PCM
    const pcm16 = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      // Convert from [-1, 1] to [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, floatData[i])); // Ensure input range
      pcm16[i] = Math.round(sample * 32767); // Use 32767 instead of 32768
    }
    
    console.log(`[VoiceService] PCM16 conversion: ${floatData.length} float samples -> ${pcm16.length} int16 samples`);
    
    // Convert to bytes (little-endian)
    const bytes = new Uint8Array(pcm16.length * 2);
    for (let i = 0; i < pcm16.length; i++) {
      bytes[i * 2] = pcm16[i] & 0xFF;
      bytes[i * 2 + 1] = (pcm16[i] >> 8) & 0xFF;
    }
    
    console.log(`[VoiceService] Final audio bytes: ${bytes.length} bytes`);
    return bytes;
  }

  private async playAudioChunk(audioData: Uint8Array) {
    // Add to playback queue
    this.audioPlaybackQueue.push(audioData);
    console.log('[VoiceService] Added audio chunk to queue, queue length:', this.audioPlaybackQueue.length);
    
    // Start playback if not already playing
    if (!this.isPlaying) {
      this.playNextAudioChunk();
    }
  }

  private async playNextAudioChunk() {
    const sessionId = this.playbackSessionId;
    if (this.audioPlaybackQueue.length === 0) {
      this.isPlaying = false;
      this.callbacks.onPlayingStateChange?.(false);
      return;
    }

    const audioData = this.audioPlaybackQueue.shift()!;
    this.isPlaying = true;
    this.callbacks.onPlayingStateChange?.(true);

    try {
      // Initialize audio context if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Resume audio context if suspended (required by browser policies)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Convert PCM16 data to AudioBuffer and play
      const audioBuffer = this.audioContext.createBuffer(1, audioData.length / 2, 16000); // 使用16kHz采样率
      const channelData = audioBuffer.getChannelData(0);
      
      // Convert 16-bit PCM to float
      for (let i = 0; i < channelData.length; i++) {
        const sample = (audioData[i * 2] | (audioData[i * 2 + 1] << 8));
        channelData[i] = sample < 32768 ? sample / 32768 : (sample - 65536) / 32768;
      }

      // Play the audio
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      this.currentAudioSource = source;
      
      source.onended = () => {
        this.currentAudioSource = null;
        console.log('[VoiceService] Audio chunk finished');
        // Play next chunk only if session not invalidated
        setTimeout(() => {
          if (sessionId === this.playbackSessionId) {
            this.playNextAudioChunk();
          }
        }, 50);
      };
      
      source.start();
      console.log('[VoiceService] Started playing audio chunk:', audioData.length, 'bytes');

    } catch (error) {
      console.error('[VoiceService] Audio playback error:', error);
      this.isPlaying = false;
      this.callbacks.onPlayingStateChange?.(false);
      // Try to play next chunk even if this one failed
      setTimeout(() => this.playNextAudioChunk(), 100);
    }
  }

  private async playMP3Audio(audioData: Uint8Array) {
    try {
      console.log('[VoiceService] Playing MP3 audio:', audioData.length, 'bytes');
      
      // Initialize audio context if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Create a new ArrayBuffer to avoid potential issues with shared buffers
      const arrayBuffer = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
      
      // Validate that we have a proper MP3 file
      const view = new Uint8Array(arrayBuffer);
      if (view.length < 3 || !(
        (view[0] === 0xFF && (view[1] & 0xE0) === 0xE0) || // MP3 frame header
        (view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33) // ID3 tag
      )) {
        console.warn('[VoiceService] Audio data does not appear to be valid MP3, first bytes:', Array.from(view.slice(0, 10)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
      }

      // Decode MP3 audio data
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Play the audio
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      // Set current audio source for proper stopping
      this.currentAudioSource = source;
      this.isPlaying = true;
      this.callbacks.onPlayingStateChange?.(true);
      
      source.onended = () => {
        this.currentAudioSource = null;
        this.isPlaying = false;
        this.callbacks.onPlayingStateChange?.(false);
        console.log('[VoiceService] MP3 audio playback finished');
      };
      
      source.start();
      console.log('[VoiceService] Started playing MP3 audio, duration:', audioBuffer.duration, 'seconds');

    } catch (error) {
      console.error('[VoiceService] MP3 audio playback error:', error);
      this.currentAudioSource = null;
      this.isPlaying = false;
      this.callbacks.onPlayingStateChange?.(false);
      
      // Fallback: try using HTML5 Audio element
      this.playMP3WithAudioElement(audioData);
    }
  }

  private playMP3WithAudioElement(audioData: Uint8Array) {
    try {
      console.log('[VoiceService] Fallback: Using HTML5 Audio element for MP3 playback');
      
      // Create blob and object URL
      const blob = new Blob([audioData], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(blob);
      
      // Create audio element
      const audio = new Audio(audioUrl);
      this.currentHtmlAudio = audio;
      
      this.isPlaying = true;
      this.callbacks.onPlayingStateChange?.(true);
      
      audio.onended = () => {
        this.isPlaying = false;
        this.callbacks.onPlayingStateChange?.(false);
        this.currentHtmlAudio = null;
        URL.revokeObjectURL(audioUrl);
        console.log('[VoiceService] HTML5 Audio playback finished');
      };
      
      audio.onerror = (error) => {
        console.error('[VoiceService] HTML5 Audio playback error:', error);
        this.isPlaying = false;
        this.callbacks.onPlayingStateChange?.(false);
        this.currentHtmlAudio = null;
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.play().catch(error => {
        console.error('[VoiceService] Failed to play audio:', error);
        this.isPlaying = false;
        this.callbacks.onPlayingStateChange?.(false);
        this.currentHtmlAudio = null;
        URL.revokeObjectURL(audioUrl);
      });
      
    } catch (error) {
      console.error('[VoiceService] HTML5 Audio fallback failed:', error);
      this.currentHtmlAudio = null;
      this.isPlaying = false;
      this.callbacks.onPlayingStateChange?.(false);
    }
  }

  private stopPlayback() {
    console.log('[VoiceService] Stopping audio playback...');
    
    // Stop current playing audio source (Web Audio API)
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
      } catch (e) {
        console.warn('[VoiceService] Error stopping current audio source:', e);
      }
      this.currentAudioSource = null;
    }
    
    // Stop current HTML audio element (fallback)
    if (this.currentHtmlAudio) {
      try {
        this.currentHtmlAudio.pause();
        this.currentHtmlAudio.currentTime = 0;
        // Clean up object URL if it exists
        if (this.currentHtmlAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(this.currentHtmlAudio.src);
        }
      } catch (e) {
        console.warn('[VoiceService] Error stopping HTML audio element:', e);
      }
      this.currentHtmlAudio = null;
    }
    
    // Clear playback queue
    this.audioPlaybackQueue = [];
    
    // Update playing state immediately
    this.isPlaying = false;
    this.callbacks.onPlayingStateChange?.(false);
    
    console.log('[VoiceService] Audio playback stopped successfully');
  }
}

// Export singleton instance
export const voiceService = new VoiceService();
