/**
 * VideoRecorder - 录制 Canvas 并导出视频
 */

import html2canvas from "html2canvas";

export interface RecorderOptions {
  canvas?: HTMLCanvasElement;
  targetElement?: HTMLElement;
  useDisplayMedia?: boolean;
  preferredFormat?: "auto" | "mp4" | "webm";
  outputScale?: number;
  fps?: number;
  videoBitsPerSecond?: number;
  onProgress?: (progress: number) => void;
}

export class VideoRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private isRecording = false;
  private canvas?: HTMLCanvasElement;
  private targetElement?: HTMLElement;
  private useDisplayMedia: boolean;
  private preferredFormat: "auto" | "mp4" | "webm";
  private outputScale: number;
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureIntervalId: number | null = null;
  private cropAnimationFrameId: number | null = null;
  private displayStream: MediaStream | null = null;
  private displayVideo: HTMLVideoElement | null = null;
  private captureBusy = false;
  private captureErrorCount = 0;
  private fps: number;
  private videoBitsPerSecond: number;
  private onProgress?: (progress: number) => void;
  private frameCount = 0;
  private startTime = 0;
  private mimeTypeUsed: string | undefined;

  constructor(options: RecorderOptions) {
    this.canvas = options.canvas;
    this.targetElement = options.targetElement;
    this.useDisplayMedia = options.useDisplayMedia ?? false;
    this.preferredFormat = options.preferredFormat ?? "auto";
    this.outputScale = options.outputScale ?? 1;
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
      let stream: MediaStream;
      if (this.useDisplayMedia && navigator.mediaDevices?.getDisplayMedia) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: this.fps,
            },
            audio: false,
          });
          this.displayStream = displayStream;

          if (this.targetElement) {
            stream = await this.createCroppedStreamFromDisplay(displayStream);
          } else {
            stream = displayStream;
          }
        } catch (error) {
          console.warn('Display media capture failed, falling back to DOM capture', error);
          const sourceCanvas = await this.prepareCaptureSource();
          stream = sourceCanvas.captureStream(this.fps);
        }
      } else {
        const sourceCanvas = await this.prepareCaptureSource();
        stream = sourceCanvas.captureStream(this.fps);
      }
      this.stream = stream;

      const mimeType = this.getSupportedMimeType();
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: this.videoBitsPerSecond,
          })
        : new MediaRecorder(stream, {
            videoBitsPerSecond: this.videoBitsPerSecond,
          });
      this.mimeTypeUsed = mediaRecorder.mimeType || mimeType;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      // Request chunks periodically to improve compatibility and avoid 0s metadata on some players.
      mediaRecorder.start(250);
      this.mediaRecorder = mediaRecorder;
      this.isRecording = true;

      if (!this.useDisplayMedia && this.targetElement) {
        this.startDomCaptureLoop();
      }
    } catch (error) {
      this.isRecording = false;
      console.error('Failed to start recording:', error);
      throw error;
    }
  }

  private async createCroppedStreamFromDisplay(displayStream: MediaStream): Promise<MediaStream> {
    const video = document.createElement('video');
    video.srcObject = displayStream;
    video.muted = true;
    video.playsInline = true;
    this.displayVideo = video;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error('Failed to initialize display capture video'));
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      void video.play().catch(() => {
        // Some browsers still provide frames even when autoplay play() rejects.
      });
    });

    const rect = this.targetElement?.getBoundingClientRect();
    if (!rect) {
      throw new Error('Target element is not available for cropped recording');
    }

    const scale = Math.max(0.5, this.outputScale);
    const outW = Math.max(2, Math.round(rect.width * scale));
    const outH = Math.max(2, Math.round(rect.height * scale));
    const canvas = this.canvas ?? document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    this.captureCanvas = canvas;

    const render = () => {
      if (!this.isRecording || !this.captureCanvas || !this.displayVideo || !this.targetElement) return;
      const ctx = this.captureCanvas.getContext('2d');
      if (!ctx) return;

      const r = this.targetElement.getBoundingClientRect();
      const vw = this.displayVideo.videoWidth || window.innerWidth;
      const vh = this.displayVideo.videoHeight || window.innerHeight;
      const sxScale = vw / Math.max(window.innerWidth, 1);
      const syScale = vh / Math.max(window.innerHeight, 1);

      const sx = Math.max(0, Math.round(r.left * sxScale));
      const sy = Math.max(0, Math.round(r.top * syScale));
      const sw = Math.max(1, Math.round(r.width * sxScale));
      const sh = Math.max(1, Math.round(r.height * syScale));

      ctx.clearRect(0, 0, this.captureCanvas.width, this.captureCanvas.height);
      ctx.drawImage(this.displayVideo, sx, sy, sw, sh, 0, 0, this.captureCanvas.width, this.captureCanvas.height);

      this.cropAnimationFrameId = requestAnimationFrame(render);
    };

    this.isRecording = true;
    render();
    return canvas.captureStream(this.fps);
  }

  private async prepareCaptureSource(): Promise<HTMLCanvasElement> {
    if (this.targetElement) {
      const rect = this.targetElement.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));

      const canvas = this.canvas ?? document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      this.captureCanvas = canvas;

      await this.captureTargetIntoCanvas();
      return canvas;
    }

    if (!this.canvas) {
      throw new Error("No capture source provided");
    }

    this.captureCanvas = this.canvas;
    return this.canvas;
  }

  private startDomCaptureLoop(): void {
    if (!this.targetElement) return;
    const interval = Math.max(16, Math.round(1000 / this.fps));
    this.captureIntervalId = window.setInterval(() => {
      void this.captureTargetIntoCanvas().catch(() => {
        // Keep recorder alive even if a frame capture fails.
      });
    }, interval);
  }

  private async captureTargetIntoCanvas(): Promise<void> {
    if (!this.targetElement || !this.captureCanvas || !this.isRecording) return;
    if (this.captureBusy) return;
    this.captureBusy = true;

    try {
      // Prefer foreignObjectRendering to avoid css color parsing limitations (e.g. oklab).
      let snapshot: HTMLCanvasElement;
      try {
        snapshot = await html2canvas(this.targetElement, {
          backgroundColor: null,
          useCORS: true,
          logging: false,
          scale: 1,
          foreignObjectRendering: true,
        });
      } catch {
        snapshot = await html2canvas(this.targetElement, {
          backgroundColor: null,
          useCORS: true,
          logging: false,
          scale: 1,
        });
      }

      const ctx = this.captureCanvas.getContext("2d");
      if (!ctx) return;

      if (this.captureCanvas.width !== snapshot.width || this.captureCanvas.height !== snapshot.height) {
        this.captureCanvas.width = snapshot.width;
        this.captureCanvas.height = snapshot.height;
      }

      ctx.clearRect(0, 0, this.captureCanvas.width, this.captureCanvas.height);
      ctx.drawImage(snapshot, 0, 0, this.captureCanvas.width, this.captureCanvas.height);
      // Force tiny pixel changes so some encoders always emit chunks.
      const tick = this.frameCount++ % 255;
      ctx.fillStyle = `rgba(${tick},0,0,0.01)`;
      ctx.fillRect(0, 0, 1, 1);
      this.captureErrorCount = 0;
    } catch (error) {
      this.captureErrorCount += 1;
      const ctx = this.captureCanvas.getContext("2d");
      if (ctx) {
        // Fallback frame keeps the stream active instead of producing 0-byte output.
        ctx.fillStyle = "#0b0b0b";
        ctx.fillRect(0, 0, this.captureCanvas.width, this.captureCanvas.height);
        const tick = this.frameCount++ % 255;
        ctx.fillStyle = `rgba(${tick},255,255,0.2)`;
        ctx.fillRect(0, 0, 1, 1);
      }
      if (this.captureErrorCount <= 2) {
        console.warn("Frame capture failed, using fallback frame", error);
      }
    } finally {
      this.captureBusy = false;
    }
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error('Recording not in progress'));
        return;
      }

      try {
        this.mediaRecorder.requestData();
      } catch {
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: this.mimeTypeUsed || 'video/webm' });
        this.recordedChunks = [];
        this.isRecording = false;

        if (this.captureIntervalId !== null) {
          window.clearInterval(this.captureIntervalId);
          this.captureIntervalId = null;
        }
        if (this.cropAnimationFrameId !== null) {
          cancelAnimationFrame(this.cropAnimationFrameId);
          this.cropAnimationFrameId = null;
        }
        if (this.displayStream) {
          this.displayStream.getTracks().forEach((track) => track.stop());
          this.displayStream = null;
        }
        if (this.displayVideo) {
          this.displayVideo.srcObject = null;
          this.displayVideo = null;
        }

        // 停止流
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }

        if (blob.size === 0) {
          reject(new Error('Recorded video is empty (0 bytes). Recorder produced no chunks, likely due to browser codec support or DOM capture failure (e.g. unsupported CSS in frame capture).'));
          return;
        }

        resolve(blob);
      };

      this.mediaRecorder.onerror = (error) => {
        this.isRecording = false;
        reject(error);
      };

      // Ensure we have enough recorded timeline before stopping.
      const elapsed = performance.now() - this.startTime;
      const stopDelay = elapsed < 500 ? Math.ceil(500 - elapsed) : 120;
      window.setTimeout(() => {
        this.mediaRecorder?.stop();
      }, stopDelay);
    });
  }

  private getSupportedMimeType(): string | undefined {
    const mp4Types = [
      'video/mp4;codecs=h264,aac',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];
    const webmTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
    ];

    const types =
      this.preferredFormat === "mp4"
        ? [...mp4Types, ...webmTypes]
        : this.preferredFormat === "webm"
          ? [...webmTypes, ...mp4Types]
          : [...mp4Types, ...webmTypes];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return undefined;
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  getOutputExtension(): "mp4" | "webm" {
    const mime = this.mimeTypeUsed || "";
    return mime.includes("mp4") ? "mp4" : "webm";
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
