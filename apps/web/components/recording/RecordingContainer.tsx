"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Upload, Play, Square } from "lucide-react";
import { RecordingDevicePreview } from "./RecordingDevicePreview";
import { VideoRecorder } from "@/lib/video-recorder";
import { transcodeWebMToMp4 } from "@/lib/browser-transcoder";
import { useToast } from "@/hooks/use-toast";

interface RecordingContainerProps {
  onBackClick: () => void;
}


type BackgroundType = "checkerboard" | "color" | "image";
type RecordingMode = "manual" | "auto";

interface AutoPlayConfig {
  sleepDuration: number; // 秒
  unlockDuration: number; // 秒
  lockDuration: number; // 秒
  swipeDuration: number; // 秒
  wakeDuration: number; // 秒
  loop: boolean;
}

type AutoCommand = { id: number; type: "sleep" | "wake" | "swipe_unlock"; durationMs?: number };

export function RecordingContainer({ onBackClick }: RecordingContainerProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewCaptureRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<VideoRecorder | null>(null);
  const autoSequenceTimeoutsRef = useRef<number[]>([]);

  // 背景配置
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("checkerboard");
  const [backgroundColor, setBackgroundColor] = useState("#f3f4f6");
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  // 录制模式
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("manual");
  const [previewScale, setPreviewScale] = useState(1); // 默认 100% 保证 1:1 对应
  const [fps, setFps] = useState(60); // 提高默认帧率到 60
  const [formatPreference, setFormatPreference] = useState<"auto" | "mp4" | "webm">("auto");
  const [useBrowserMp4Transcode, setUseBrowserMp4Transcode] = useState(true);
  const [isConvertingToMp4, setIsConvertingToMp4] = useState(false);
  const [resolutionMode, setResolutionMode] = useState<"preview-sync" | "preset">("preview-sync");
  const [resolutionPreset, setResolutionPreset] = useState<"1080x1920" | "1290x2796" | "1440x3120" | "2160x4680" | "custom">("1290x2796");

  // 自动播放配置
  const [autoPlayConfig, setAutoPlayConfig] = useState<AutoPlayConfig>({
    sleepDuration: 2,
    unlockDuration: 2,
    lockDuration: 2,
    swipeDuration: 0.8,
    wakeDuration: 0.6,
    loop: true,
  });

  // 录制状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [autoCommand, setAutoCommand] = useState<AutoCommand | undefined>(undefined);
  const [exportFilename, setExportFilename] = useState(
    `recording-${new Date().getTime()}.mp4`
  );

  const clearAutoSequence = () => {
    for (const timeoutId of autoSequenceTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    autoSequenceTimeoutsRef.current = [];
  };

  const emitAutoCommand = (type: AutoCommand["type"], durationMs?: number) => {
    setAutoCommand({ id: Date.now() + Math.floor(Math.random() * 1000), type, durationMs });
  };

  // 处理背景上传
  const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setBackgroundImage(event.target?.result as string);
      setBackgroundType("image");
    };
    reader.readAsDataURL(file);
  };

  // 获取背景样式
  const getBackgroundStyle = (): React.CSSProperties => {
    if (backgroundType === "checkerboard") {
      return {
        background:
          "repeating-conic-gradient(#f8fafc 0% 25%, #e5e7eb 0% 50%) 50% center / 20px 20px",
      };
    } else if (backgroundType === "color") {
      return { background: backgroundColor };
    } else if (backgroundType === "image" && backgroundImage) {
      return {
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    return {};
  };

  // 开始录制
  const handleStartRecording = async () => {
    if (!previewCaptureRef.current) {
      toast({ title: "Error", description: "Preview area not found", variant: "destructive" });
      return;
    }

    if (!VideoRecorder.isSupportedInBrowser()) {
      toast({
        title: "Not Supported",
        description: "Your browser doesn't support video recording",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsRecording(true);
      
      // 计算 outputScale：预览缩放就是导出缩放，保证 1:1 对应
      // 如果使用预设分辨率，需要根据当前设备预览尺寸计算 scale
      let outputScale = previewScale;
      let videoBitrate = 5000000; // 基础码率 5Mbps
      
      if (resolutionMode === "preset" && previewCaptureRef.current) {
        const rect = previewCaptureRef.current.getBoundingClientRect();
        let presetW = 540, presetH = 960;
        
        if (resolutionPreset === "1080x1920") {
          presetW = 540; presetH = 960;
        } else if (resolutionPreset === "1290x2796") {
          presetW = 645; presetH = 1398;
        } else if (resolutionPreset === "1440x3120") {
          presetW = 720; presetH = 1560;
        } else if (resolutionPreset === "2160x4680") {
          presetW = 1080; presetH = 2340;
        }
        
        // 预设尺寸除以设备预览基础尺寸，得到对应 scale
        outputScale = Math.max(0.5, presetW / (rect.width / previewScale));
      }
      
      // 根据分辨率和帧率动态计算码率
      // 计算像素数
      const pixelCount = (previewCaptureRef.current?.getBoundingClientRect().width ?? 390) * 
                         (previewCaptureRef.current?.getBoundingClientRect().height ?? 844) * 
                         (outputScale * outputScale);

      const recorderPreferredFormat =
        useBrowserMp4Transcode && formatPreference === "mp4" ? "webm" : formatPreference;

      const highLoadPreset = resolutionPreset === "2160x4680" || fps >= 120;
      const baseBpp =
        recorderPreferredFormat === "webm"
          ? 0.07
          : recorderPreferredFormat === "mp4"
            ? 0.1
            : 0.085;
      const tunedBpp = highLoadPreset ? baseBpp * 0.8 : baseBpp;

      // 限制码率上限，避免高分辨率+高帧率下编码器卡顿
      const rawBitrate = Math.round(pixelCount * fps * tunedBpp);
      videoBitrate = Math.max(4_000_000, Math.min(28_000_000, rawBitrate));

      recorderRef.current = new VideoRecorder({
        canvas: canvasRef.current ?? undefined,
        targetElement: previewCaptureRef.current,
        useDisplayMedia: true,
        preferredFormat: recorderPreferredFormat,
        outputScale,
        fps,
        videoBitsPerSecond: videoBitrate,
        onProgress: setRecordingProgress,
      });

      await recorderRef.current.start();

      // 如果是自动模式，自动播放动画
      if (recordingMode === "auto") {
        runAutoPlaySequence();
      }

      toast({ title: "Recording started", description: "If prompted, choose this browser tab for best results" });
    } catch (error) {
      console.error("Failed to start recording:", error);
      const message = error instanceof Error ? error.message : "Failed to start recording";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
      setIsRecording(false);
    }
  };

  // 自动播放序列
  const runAutoPlaySequence = async (): Promise<void> => {
    clearAutoSequence();

    const sleepMs = autoPlayConfig.sleepDuration * 1000;
    const holdUnlockedMs = autoPlayConfig.unlockDuration * 1000;
    const beforeSwipeMs = autoPlayConfig.lockDuration * 1000;
    const wakeMs = Math.max(100, Math.round(autoPlayConfig.wakeDuration * 1000));
    const swipeMs = Math.max(100, Math.round(autoPlayConfig.swipeDuration * 1000));
    const cycleMs = sleepMs + wakeMs + beforeSwipeMs + swipeMs + holdUnlockedMs;

    const runCycle = () => {
      // Step 1: start from sleep
      emitAutoCommand("sleep");

      autoSequenceTimeoutsRef.current.push(
        window.setTimeout(() => {
          // Step 2: click side button to wake to lock screen
          emitAutoCommand("wake", wakeMs);
        }, sleepMs)
      );

      autoSequenceTimeoutsRef.current.push(
        window.setTimeout(() => {
          // Step 3: swipe up to unlock
          emitAutoCommand("swipe_unlock", swipeMs);
        }, sleepMs + wakeMs + beforeSwipeMs)
      );

      // Step 4: after showing unlocked for a while, sleep again (next cycle starts from sleep)
      autoSequenceTimeoutsRef.current.push(
        window.setTimeout(() => {
          emitAutoCommand("sleep");
        }, sleepMs + wakeMs + beforeSwipeMs + swipeMs + holdUnlockedMs)
      );

      if (autoPlayConfig.loop) {
        autoSequenceTimeoutsRef.current.push(
          window.setTimeout(() => {
            runCycle();
          }, cycleMs)
        );
      }
    };

    runCycle();
    return Promise.resolve();
  };

  // 停止录制
  const handleStopRecording = async () => {
    if (!recorderRef.current || !isRecording) return;

    try {
      clearAutoSequence();
      setAutoCommand(undefined);
      const blob = await recorderRef.current.stop();

      if (blob.size === 0) {
        throw new Error("Empty video output (0 bytes)");
      }

      setIsRecording(false);

      const recordedExt = recorderRef.current.getOutputExtension();
      const desiredExt = formatPreference === "auto" ? recordedExt : formatPreference;

      let outputBlob = blob;
      let outputExt: "webm" | "mp4" = recordedExt;

      if (
        desiredExt === "mp4" &&
        recordedExt === "webm" &&
        useBrowserMp4Transcode
      ) {
        setIsConvertingToMp4(true);
        toast({
          title: "Converting to MP4",
          description: "Browser is converting WebM to MP4...",
        });

        try {
          outputBlob = await transcodeWebMToMp4(blob);
          outputExt = "mp4";
        } catch (convertError) {
          console.warn("MP4 conversion failed, fallback to WebM:", convertError);
          outputBlob = blob;
          outputExt = "webm";
          toast({
            title: "MP4 conversion failed",
            description: "Exported as WebM instead. You can still upload after local conversion.",
            variant: "destructive",
          });
        } finally {
          setIsConvertingToMp4(false);
        }
      } else if (desiredExt === "mp4" && recordedExt === "webm") {
        toast({
          title: "Exported as WebM",
          description: "MP4 codec not available in this browser for current settings.",
        });
      }

      const normalizedFilename = exportFilename.replace(/\.(webm|mp4)$/i, "") + `.${outputExt}`;

      // 导出视频
      await VideoRecorder.exportVideo(outputBlob, normalizedFilename);

      toast({
        title: "Success",
        description: `Video exported (${Math.round(outputBlob.size / 1024)} KB) as ${normalizedFilename}`,
      });
    } catch (error) {
      console.error("Failed to stop recording:", error);
      const message = error instanceof Error ? error.message : "Failed to export video";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    return () => {
      clearAutoSequence();
    };
  }, []);

  return (
    <div className="flex h-screen bg-background">
      {/* 左侧配置面板 */}
      <div className="w-80 border-r overflow-y-auto flex flex-col">
        <div className="p-4 border-b flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBackClick}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="font-semibold flex-1">Recording Studio</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* 背景配置 */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Background</h3>
            <Select value={backgroundType} onValueChange={(v) => setBackgroundType(v as BackgroundType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checkerboard">Checkerboard</SelectItem>
                <SelectItem value="color">Solid Color</SelectItem>
                <SelectItem value="image">Image</SelectItem>
              </SelectContent>
            </Select>

            {backgroundType === "color" && (
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="h-10 w-20"
                />
                <Input
                  type="text"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  placeholder="#f3f4f6"
                  className="flex-1 text-sm"
                />
              </div>
            )}

            {backgroundType === "image" && (
              <div className="space-y-2">
                <label className="flex items-center justify-center w-full px-4 py-2 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    <span className="text-sm">Click to upload</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBackgroundUpload}
                    className="hidden"
                  />
                </label>
                {backgroundImage && (
                  <div className="text-xs text-muted-foreground">Image loaded</div>
                )}
              </div>
            )}
          </div>

          {/* 录制模式 */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Recording Mode</h3>
            <Tabs value={recordingMode} onValueChange={(v) => setRecordingMode(v as RecordingMode)}>
              <TabsList className="w-full">
                <TabsTrigger value="manual" className="flex-1">
                  Manual
                </TabsTrigger>
                <TabsTrigger value="auto" className="flex-1">
                  Auto
                </TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>Click and drag on the device preview to manually control the animation.</p>
              </TabsContent>

              <TabsContent value="auto" className="mt-3 space-y-3">
                <div>
                  <Label className="text-sm">Sleep Duration (s)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    value={autoPlayConfig.sleepDuration}
                    onChange={(e) =>
                      setAutoPlayConfig((prev) => ({
                        ...prev,
                        sleepDuration: parseInt(e.target.value) || 1,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Unlocked Hold (s)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    value={autoPlayConfig.unlockDuration}
                    onChange={(e) =>
                      setAutoPlayConfig((prev) => ({
                        ...prev,
                        unlockDuration: parseInt(e.target.value) || 1,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Before Swipe Delay (s)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    value={autoPlayConfig.lockDuration}
                    onChange={(e) =>
                      setAutoPlayConfig((prev) => ({
                        ...prev,
                        lockDuration: parseInt(e.target.value) || 1,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Wake Animation (s)</Label>
                  <Input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={autoPlayConfig.wakeDuration}
                    onChange={(e) =>
                      setAutoPlayConfig((prev) => ({
                        ...prev,
                        wakeDuration: parseFloat(e.target.value) || 0.6,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Swipe Duration (s)</Label>
                  <Input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={autoPlayConfig.swipeDuration}
                    onChange={(e) =>
                      setAutoPlayConfig((prev) => ({
                        ...prev,
                        swipeDuration: parseFloat(e.target.value) || 0.8,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <Label className="text-sm">Loop playback</Label>
                  <input
                    type="checkbox"
                    checked={autoPlayConfig.loop}
                    onChange={(e) =>
                      setAutoPlayConfig((prev) => ({
                        ...prev,
                        loop: e.target.checked,
                      }))
                    }
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium text-sm">Preview Zoom</h3>
            <Input
              type="range"
              min="0.5"
              max="1.35"
              step="0.05"
              value={previewScale}
              onChange={(e) => setPreviewScale(parseFloat(e.target.value) || 1)}
            />
            <div className="text-xs text-muted-foreground">
              {Math.round(previewScale * 100)}% (导出与预览 1:1 对应)
            </div>
          </div>

          {/* 分辨率设置 */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Resolution</h3>
            <Select value={resolutionMode} onValueChange={(v) => setResolutionMode(v as "preview-sync" | "preset")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview-sync">Follow Preview Zoom</SelectItem>
                <SelectItem value="preset">Use Preset</SelectItem>
              </SelectContent>
            </Select>
            
            {resolutionMode === "preset" && (
              <Select value={resolutionPreset} onValueChange={(v) => setResolutionPreset(v as "1080x1920" | "1290x2796" | "1440x3120" | "2160x4680" | "custom")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1080x1920">1080 × 1920 (2×)</SelectItem>
                  <SelectItem value="1290x2796">1290 × 2796 (3×)</SelectItem>
                  <SelectItem value="1440x3120">1440 × 3120 (4×)</SelectItem>
                  <SelectItem value="2160x4680">2160 × 4680 (6×)</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 帧率设置 */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Frame Rate</h3>
            <Select value={fps.toString()} onValueChange={(v) => setFps(parseInt(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 fps</SelectItem>
                <SelectItem value="30">30 fps</SelectItem>
                <SelectItem value="60">60 fps (推荐)</SelectItem>
                <SelectItem value="120">120 fps (最流畅)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 导出设置 */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Export</h3>
            <div>
              <Label className="text-sm">Format</Label>
              <Select value={formatPreference} onValueChange={(v) => setFormatPreference(v as "auto" | "mp4" | "webm") }>
                <SelectTrigger className="w-full mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (balanced)</SelectItem>
                  <SelectItem value="mp4">MP4 (social upload)</SelectItem>
                  <SelectItem value="webm">WebM (performance)</SelectItem>
                </SelectContent>
              </Select>

              {formatPreference === "mp4" && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={useBrowserMp4Transcode}
                    onChange={(e) => setUseBrowserMp4Transcode(e.target.checked)}
                  />
                  Record as WebM then convert to MP4 in browser (smoother at high resolution)
                </label>
              )}
            </div>
            <div>
              <Label className="text-sm">Filename</Label>
              <Input
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder="recording.mp4"
                className="mt-1 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 录制控制按钮 */}
        <div className="p-4 border-t space-y-2">
          {!isRecording ? (
            <Button onClick={handleStartRecording} className="w-full" size="lg">
              <Play className="h-4 w-4 mr-2" />
              Start Recording
            </Button>
          ) : (
            <Button
              onClick={handleStopRecording}
              variant="destructive"
              className="w-full"
              size="lg"
            >
              <Square className="h-4 w-4 mr-2" />
              Stop & Export
            </Button>
          )}
          {recordingProgress > 0 && (
            <div className="text-xs text-muted-foreground text-center">
              Recording: {recordingProgress}%
            </div>
          )}
          {isConvertingToMp4 && (
            <div className="text-xs text-muted-foreground text-center animate-pulse">
              Converting WebM to MP4...
            </div>
          )}
        </div>
      </div>

      {/* 右侧预览区 */}
      <div className="flex-1 flex items-center justify-center overflow-hidden" ref={containerRef}>
        <div
          className="w-full h-full flex items-center justify-center"
          style={getBackgroundStyle()}
        >
          {/* 隐藏的Canvas用于录制 */}
          <canvas
            ref={canvasRef}
            style={{ display: "none" }}
            width={390}
            height={844}
          />

          {/* 设备预览 */}
          <div className="relative" ref={previewCaptureRef}>
            <RecordingDevicePreview
              scale={previewScale}
              autoCommand={recordingMode === "auto" ? autoCommand : undefined}
              disableInteractions={recordingMode === "auto"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
