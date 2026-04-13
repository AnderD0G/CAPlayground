/**
 * VideoRecorder - 录制 Canvas 并导出视频
 */

export interface RecorderOptions {
  canvas: HTMLCanvasElement;
  fps?: number;
  videoBitsPerSecond?: number;
  onProgress?: (progress: number) => void;
}

export class VideoRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private isRecording = false;
  private canvas: HTMLCanvasElement;
  private fps: number;
  private videoBitsPerSecond: number;
  private onProgress?: (progress: number) => void;
  private frameCount = 0;
  private startTime = 0;

  constructor(options: RecorderOptions) {
    this.canvas = options.canvas;
    this.fps = options.fps || 30;
    this.videoBitsPerSecond = options.videoBitsPerSecond || 5000000; // 5Mbps
    this.onProgress = options.onProgress;
  }

  async start(): Promise<void> {
    if (this.isRecording) {
      console.warn('Recording already in progress');
      return;
    }

    this.recordedChunks = [];
    this.frameCount = 0;
    this.startTime = performance.now();

    try {
      // 从 Canvas 获取媒体流
      const stream = this.canvas.captureStream(this.fps);
      this.stream = stream;

      const mimeType = this.getSupportedMimeType();
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: this.videoBitsPerSecond,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      mediaRecorder.start();
      this.mediaRecorder = mediaRecorder;
      this.isRecording = true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      throw error;
    }
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error('Recording not in progress'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.getSupportedMimeType();
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        this.recordedChunks = [];
        this.isRecording = false;

        // 停止流
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }

        resolve(blob);
      };

      this.mediaRecorder.onerror = (error) => {
        this.isRecording = false;
        reject(error);
      };

      this.mediaRecorder.stop();
    });
  }

  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'video/webm';
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * 导出视频为文件
   */
  static async exportVideo(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 检查浏览器是否支持 Canvas.captureStream
   */
  static isSupportedInBrowser(): boolean {
    if (typeof window === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return (
      typeof canvas.captureStream === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  }
}
