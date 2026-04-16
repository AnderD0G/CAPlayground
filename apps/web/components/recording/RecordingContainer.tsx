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
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Switch } from "@/components/ui/switch";
import { Sun, Moon } from "lucide-react";

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
  const [backgroundBlur, setBackgroundBlur] = useState(0);
  const [backgroundOverlayColor, setBackgroundOverlayColor] = useState("#000000");
  const [backgroundOverlayOpacity, setBackgroundOverlayOpacity] = useState(0);

  // 录制模式
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("manual");
  const [previewScale, setPreviewScale] = useState(1); // 默认 100% 保证 1:1 对应
  const [fps, setFps] = useState(60); // 提高默认帧率到 60
  const [formatPreference, setFormatPreference] = useState<"auto" | "mp4" | "webm">("auto");
  const [useBrowserMp4Transcode, setUseBrowserMp4Transcode] = useState(true);
  const [isConvertingToMp4, setIsConvertingToMp4] = useState(false);
  const [resolutionMode, setResolutionMode] = useState<"preview-sync" | "preset">("preview-sync");
  const [resolutionPreset, setResolutionPreset] = useState<"1080x1920" | "1290x2796" | "1440x3120" | "2160x4680" | "4320x9360" | "custom">("1290x2796");

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
  const [clockDepthEffect, setClockDepthEffect] = useLocalStorage<boolean>("caplay_preview_clock_depth", false);
  const [previewTheme, setPreviewTheme] = useLocalStorage<"Light" | "Dark">("caplay_preview_theme", "Light");
  const [hasAppearanceSplit, setHasAppearanceSplit] = useState(false);
  const [autoStopEnabled, setAutoStopEnabled] = useState(false);
  const [autoStopSeconds, setAutoStopSeconds] = useState(10);
  const [autoStopRemainingMs, setAutoStopRemainingMs] = useState<number | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const autoStopTimeoutRef = useRef<number | null>(null);
  const autoStopIntervalRef = useRef<number | null>(null);
  const autoStopDeadlineRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const isStoppingRef = useRef(false);

  // 签名配置
  const [showSignature, setShowSignature] = useState(false);
  const [signatureText, setSignatureText] = useState("Signature");
  const [signaturePlacement, setSignaturePlacement] = useState<"top" | "bottom">("bottom");
  const [signatureVertical, setSignatureVertical] = useState(50); // 0-100，距离安全区顶部的百分比
  const [signatureHorizontal, setSignatureHorizontal] = useState(50); // 0-100，左右位置百分比
  const [signatureFontSize, setSignatureFontSize] = useState(14);
  const [signatureFont, setSignatureFont] = useState("Arial");
  const [signatureColor, setSignatureColor] = useState("#000000");
  const [signatureOpacity, setSignatureOpacity] = useState(0.85);

  // 图片签名
  const [signatureMode, setSignatureMode] = useState<"text" | "image">("text"); // 签名模式：文字或图片
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [signatureImageWidth, setSignatureImageWidth] = useState(80); // 图片宽度像素
  const [signatureImageOpacity, setSignatureImageOpacity] = useState(0.9);

  const handleSignatureImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setSignatureImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearAutoSequence = () => {
    for (const timeoutId of autoSequenceTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    autoSequenceTimeoutsRef.current = [];
  };

  const clearAutoStop = () => {
    if (autoStopTimeoutRef.current != null) {
      window.clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    if (autoStopIntervalRef.current != null) {
      window.clearInterval(autoStopIntervalRef.current);
      autoStopIntervalRef.current = null;
    }
    autoStopDeadlineRef.current = null;
    setAutoStopRemainingMs(null);
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
    const blurStyle: React.CSSProperties =
      backgroundBlur > 0
        ? {
            filter: `blur(${backgroundBlur}px)`,
            transform: "scale(1.04)",
          }
        : {};

    if (backgroundType === "checkerboard") {
      return {
        background:
          "repeating-conic-gradient(#f8fafc 0% 25%, #e5e7eb 0% 50%) 50% center / 20px 20px",
        ...blurStyle,
      };
    } else if (backgroundType === "color") {
      return { background: backgroundColor, ...blurStyle };
    } else if (backgroundType === "image" && backgroundImage) {
      return {
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        ...blurStyle,
      };
    }
    return blurStyle;
  };

  const getBackgroundOverlayStyle = (): React.CSSProperties => ({
    backgroundColor: backgroundOverlayColor,
    opacity: backgroundOverlayOpacity,
  });
  // 获取签名样式
  const getSignatureStyle = (): React.CSSProperties => {
    const safeAreaPercent = 4; // 4% 安全区距离
    const safeAreaPx = 16; // 约 4% of 390/2
    const availableHeight = 100 - safeAreaPercent * 2; // 92%
    const availableWidth = 100 - safeAreaPercent * 2; // 92%
    
    // 垂直位置：根据 signatureVertical (0-100) 和 signaturePlacement
    let topPercent: number;
    if (signaturePlacement === "top") {
      topPercent = safeAreaPercent + (signatureVertical / 100) * availableHeight;
    } else {
      topPercent = 100 - safeAreaPercent - ((100 - signatureVertical) / 100) * availableHeight;
    }
    
    // 水平位置：根据 signatureHorizontal (0-100)
    const leftPercent = safeAreaPercent + (signatureHorizontal / 100) * availableWidth;
    
    return {
      position: "absolute",
      left: `${leftPercent}%`,
      top: `${topPercent}%`,
      transform: "translate(-50%, -50%)",
      fontSize: `${signatureFontSize}px`,
      fontFamily: signatureFont,
      color: signatureColor,
      opacity: signatureOpacity,
      textShadow: "0 1px 8px rgba(0,0,0,0.3)",
      pointerEvents: "none",
      whiteSpace: "nowrap",
    };
  };

  // 获取图片签名样式
  const getSignatureImageStyle = (): React.CSSProperties => {
    const safeAreaPercent = 4; // 4% 安全区距离
    const availableHeight = 100 - safeAreaPercent * 2; // 92%
    const availableWidth = 100 - safeAreaPercent * 2; // 92%
    
    // 垂直位置：根据 signatureVertical (0-100) 和 signaturePlacement
    let topPercent: number;
    if (signaturePlacement === "top") {
      topPercent = safeAreaPercent + (signatureVertical / 100) * availableHeight;
    } else {
      topPercent = 100 - safeAreaPercent - ((100 - signatureVertical) / 100) * availableHeight;
    }
    
    // 水平位置：根据 signatureHorizontal (0-100)
    const leftPercent = safeAreaPercent + (signatureHorizontal / 100) * availableWidth;
    
    return {
      position: "absolute",
      left: `${leftPercent}%`,
      top: `${topPercent}%`,
      transform: "translate(-50%, -50%)",
      width: `${signatureImageWidth}px`,
      height: "auto",
      opacity: signatureImageOpacity,
      pointerEvents: "none",
      objectFit: "contain",
      filter: "drop-shadow(0 1px 8px rgba(0,0,0,0.3))",
    };
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
      isRecordingRef.current = true;
      isStoppingRef.current = false;
      setIsStopping(false);
      
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
        } else if (resolutionPreset === "4320x9360") {
          presetW = 2160; presetH = 4680;
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

      const highLoadPreset = resolutionPreset === "2160x4680" || resolutionPreset === "4320x9360" || fps >= 120;
      const baseBpp =
        recorderPreferredFormat === "webm"
          ? 0.07
          : recorderPreferredFormat === "mp4"
            ? 0.1
            : 0.085;
      const tunedBpp = highLoadPreset ? baseBpp * 0.8 : baseBpp;

      // 限制码率上限，避免高分辨率+高帧率下编码器卡顿
      const rawBitrate = Math.round(pixelCount * fps * tunedBpp);
      videoBitrate = Math.max(4_000_000, Math.min(42_000_000, rawBitrate));

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

      if (autoStopEnabled) {
        clearAutoStop();
        const durationMs = Math.max(1000, Math.round(autoStopSeconds * 1000));
        autoStopDeadlineRef.current = Date.now() + durationMs;
        setAutoStopRemainingMs(durationMs);

        autoStopIntervalRef.current = window.setInterval(() => {
          const deadline = autoStopDeadlineRef.current;
          if (deadline == null) return;
          const remaining = Math.max(0, deadline - Date.now());
          setAutoStopRemainingMs(remaining);
        }, 200);

        autoStopTimeoutRef.current = window.setTimeout(() => {
          void handleStopRecording("auto");
        }, durationMs);
      }

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
      isRecordingRef.current = false;
      clearAutoStop();
      setIsStopping(false);
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
  const handleStopRecording = async (source: "manual" | "auto" = "manual") => {
    if (!recorderRef.current || !isRecordingRef.current || isStoppingRef.current) return;
    isStoppingRef.current = true;
    setIsStopping(true);

    try {
      clearAutoStop();
      clearAutoSequence();
      setAutoCommand(undefined);
      if (source === "auto") {
        toast({ title: "Auto stop", description: "Time is up. Stopping and exporting..." });
      }
      const stopTimeoutMs =
        resolutionPreset === "4320x9360"
          ? 120000
          : resolutionPreset === "2160x4680"
            ? 60000
            : 30000;
      const blob = await recorderRef.current.stop(stopTimeoutMs);

      if (blob.size === 0) {
        throw new Error("Empty video output (0 bytes)");
      }

      setIsRecording(false);
      isRecordingRef.current = false;

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
      isRecordingRef.current = false;
      setIsRecording(false);
      const message = error instanceof Error ? error.message : "Failed to export video";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    } finally {
      isStoppingRef.current = false;
      setIsStopping(false);
    }
  };

  useEffect(() => {
    return () => {
      clearAutoSequence();
      clearAutoStop();
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

            <div>
              <Label className="text-xs">Background Blur ({backgroundBlur}px)</Label>
              <Input
                type="range"
                min="0"
                max="40"
                step="1"
                value={backgroundBlur}
                onChange={(e) => setBackgroundBlur(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Background Mask</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={backgroundOverlayColor}
                  onChange={(e) => setBackgroundOverlayColor(e.target.value)}
                  className="h-10 w-20"
                />
                <Input
                  type="text"
                  value={backgroundOverlayColor}
                  onChange={(e) => setBackgroundOverlayColor(e.target.value)}
                  placeholder="#000000"
                  className="flex-1 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">
                  Mask Opacity ({Math.round(backgroundOverlayOpacity * 100)}%)
                </Label>
                <Input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.01"
                  value={backgroundOverlayOpacity}
                  onChange={(e) => setBackgroundOverlayOpacity(parseFloat(e.target.value) || 0)}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* 签名配置 */}
          <div className="space-y-3 rounded-md border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-sm">Signature</h3>
              <Switch
                checked={showSignature}
                onCheckedChange={setShowSignature}
              />
            </div>
            
            {showSignature && (
              <div className="space-y-3">
                {/* 签名模式选择 */}
                <Tabs value={signatureMode} onValueChange={(v: any) => setSignatureMode(v)}>
                  <TabsList className="w-full h-8">
                    <TabsTrigger value="text" className="text-xs flex-1">Text</TabsTrigger>
                    <TabsTrigger value="image" className="text-xs flex-1">Image</TabsTrigger>
                  </TabsList>

                  {/* 文字签名 */}
                  <TabsContent value="text" className="space-y-3 mt-2">
                    <div>
                      <Label className="text-xs">Text</Label>
                      <Input
                        value={signatureText}
                        onChange={(e) => setSignatureText(e.target.value)}
                        placeholder="Enter signature"
                        className="mt-1 text-sm h-8"
                      />
                    </div>

                    <div>
                      <Label className="text-xs">Font Size ({signatureFontSize}px)</Label>
                      <input
                        type="range"
                        min="8"
                        max="36"
                        step="1"
                        value={signatureFontSize}
                        onChange={(e) => setSignatureFontSize(parseInt(e.target.value))}
                        className="w-full mt-1 h-2"
                      />
                    </div>

                    <div>
                      <Label className="text-xs">Font</Label>
                      <Select value={signatureFont} onValueChange={setSignatureFont}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Arial">Arial</SelectItem>
                          <SelectItem value="Georgia">Georgia</SelectItem>
                          <SelectItem value="Times New Roman">Times New Roman</SelectItem>
                          <SelectItem value="Courier New">Courier New</SelectItem>
                          <SelectItem value="Verdana">Verdana</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs">Color</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          type="color"
                          value={signatureColor}
                          onChange={(e) => setSignatureColor(e.target.value)}
                          className="h-8 w-16"
                        />
                        <Input
                          type="text"
                          value={signatureColor}
                          onChange={(e) => setSignatureColor(e.target.value)}
                          className="flex-1 text-xs h-8"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Opacity ({Math.round(signatureOpacity * 100)}%)</Label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={signatureOpacity}
                        onChange={(e) => setSignatureOpacity(parseFloat(e.target.value))}
                        className="w-full mt-1 h-2"
                      />
                    </div>
                  </TabsContent>

                  {/* 图片签名 */}
                  <TabsContent value="image" className="space-y-3 mt-2">
                    <div>
                      <Label className="text-xs">Upload Image</Label>
                      <label className="flex items-center justify-center w-full px-3 py-2 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors mt-1">
                        <div className="flex items-center gap-2">
                          <Upload className="h-4 w-4" />
                          <span className="text-xs">Click to upload</span>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleSignatureImageUpload}
                          className="hidden"
                        />
                      </label>
                      {signatureImage && (
                        <div className="mt-2 text-xs text-muted-foreground">Image loaded ✓</div>
                      )}
                    </div>

                    <div>
                      <Label className="text-xs">Width ({signatureImageWidth}px)</Label>
                      <input
                        type="range"
                        min="20"
                        max="200"
                        step="5"
                        value={signatureImageWidth}
                        onChange={(e) => setSignatureImageWidth(parseInt(e.target.value))}
                        className="w-full mt-1 h-2"
                      />
                    </div>

                    <div>
                      <Label className="text-xs">Opacity ({Math.round(signatureImageOpacity * 100)}%)</Label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={signatureImageOpacity}
                        onChange={(e) => setSignatureImageOpacity(parseFloat(e.target.value))}
                        className="w-full mt-1 h-2"
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                {/* 公共位置控制 */}
                <div className="border-t pt-3">
                  <div>
                    <Label className="text-xs">Position</Label>
                    <Select value={signaturePlacement} onValueChange={(v: any) => setSignaturePlacement(v)}>
                      <SelectTrigger className="h-8 text-sm mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="top">Top</SelectItem>
                        <SelectItem value="bottom">Bottom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="mt-3">
                    <Label className="text-xs">Vertical Distance ({signatureVertical}%)</Label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={signatureVertical}
                      onChange={(e) => setSignatureVertical(parseInt(e.target.value))}
                      className="w-full mt-1 h-2"
                    />
                  </div>

                  <div className="mt-3">
                    <Label className="text-xs">Horizontal Position ({signatureHorizontal}%)</Label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={signatureHorizontal}
                      onChange={(e) => setSignatureHorizontal(parseInt(e.target.value))}
                      className="w-full mt-1 h-2"
                    />
                  </div>
                </div>
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
              max="2.5"
              step="0.05"
              value={previewScale}
              onChange={(e) => setPreviewScale(parseFloat(e.target.value) || 1)}
            />
            <div className="text-xs text-muted-foreground">
              {Math.round(previewScale * 100)}% (导出与预览 1:1 对应)
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium text-sm">Preview Controls</h3>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <Label className="text-sm">Depth Effect</Label>
              <Switch
                checked={clockDepthEffect}
                onCheckedChange={setClockDepthEffect}
              />
            </div>
            <div className="space-y-2 rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm">Appearance</Label>
                <div className="flex items-center gap-2">
                  <Sun className="h-3 w-3" />
                  <Switch
                    checked={previewTheme === "Dark"}
                    onCheckedChange={(checked) => setPreviewTheme(checked ? "Dark" : "Light")}
                    disabled={!hasAppearanceSplit}
                  />
                  <Moon className="h-3 w-3" />
                </div>
              </div>
              {!hasAppearanceSplit && (
                <p className="text-xs text-muted-foreground">
                  This project has no Light/Dark split states.
                </p>
              )}
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
              <Select value={resolutionPreset} onValueChange={(v) => setResolutionPreset(v as "1080x1920" | "1290x2796" | "1440x3120" | "2160x4680" | "4320x9360" | "custom")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1080x1920">1080 × 1920 (2×)</SelectItem>
                  <SelectItem value="1290x2796">1290 × 2796 (3×)</SelectItem>
                  <SelectItem value="1440x3120">1440 × 3120 (4×)</SelectItem>
                  <SelectItem value="2160x4680">2160 × 4680 (6×)</SelectItem>
                  <SelectItem value="4320x9360">4320 × 9360 (8K)</SelectItem>
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
            <div className="space-y-2 rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm">Auto Stop & Export</Label>
                <Switch
                  checked={autoStopEnabled}
                  onCheckedChange={setAutoStopEnabled}
                  disabled={isRecording || isStopping}
                />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={autoStopSeconds}
                  onChange={(e) => setAutoStopSeconds(Math.max(1, parseInt(e.target.value) || 1))}
                  disabled={!autoStopEnabled || isRecording || isStopping}
                />
                <span className="text-xs text-muted-foreground shrink-0">seconds</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatically stops recording and starts export after the set duration.
              </p>
            </div>
          </div>
        </div>

        {/* 录制控制按钮 */}
        <div className="p-4 border-t space-y-2">
          {!isRecording ? (
            <Button onClick={handleStartRecording} className="w-full" size="lg" disabled={isStopping}>
              <Play className="h-4 w-4 mr-2" />
              Start Recording
            </Button>
          ) : (
            <Button
              onClick={() => void handleStopRecording("manual")}
              variant="destructive"
              className="w-full"
              size="lg"
              disabled={isStopping}
            >
              <Square className="h-4 w-4 mr-2" />
              {isStopping ? "Stopping..." : "Stop & Export"}
            </Button>
          )}
          {isRecording && autoStopEnabled && autoStopRemainingMs != null && (
            <div className="text-xs text-muted-foreground text-center">
              Auto stop in {Math.ceil(autoStopRemainingMs / 1000)}s
            </div>
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
      <div className="flex-1 relative flex items-center justify-center overflow-hidden" ref={containerRef}>
        <div
          className="absolute -inset-8"
          style={getBackgroundStyle()}
        />
        {backgroundOverlayOpacity > 0 && (
          <div
            className="absolute inset-0"
            style={getBackgroundOverlayStyle()}
          />
        )}
        <div className="relative z-10 w-full h-full flex items-center justify-center">
          {/* 隐藏的Canvas用于录制 */}
          <canvas
            ref={canvasRef}
            style={{ display: "none" }}
            width={390}
            height={844}
          />

          {/* 设备预览 */}
          <div className="relative" ref={previewCaptureRef}>
            {/* 录制前显示捕捉区域框 */}
            {!isRecording && (
              <div 
                className="absolute inset-0 rounded-2xl border-2 border-dashed border-primary/50 pointer-events-none z-40"
                style={{
                  boxShadow: "inset 0 0 0 1px rgba(59, 130, 246, 0.2)"
                }}
              >
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-medium text-primary/70">
                  Capture Area
                </div>
              </div>
            )}

            <RecordingDevicePreview
              scale={previewScale}
              autoCommand={recordingMode === "auto" ? autoCommand : undefined}
              disableInteractions={recordingMode === "auto"}
              showTopControls={false}
              clockDepthEffect={clockDepthEffect}
              onClockDepthEffectChange={setClockDepthEffect}
              theme={previewTheme}
              onThemeChange={setPreviewTheme}
              onAppearanceSplitChange={setHasAppearanceSplit}
            />

            {/* 签名层 */}
            {showSignature && (
              <div 
                className="absolute inset-0 pointer-events-none z-20 rounded-2xl overflow-hidden"
                style={{
                  padding: "4%"
                }}
              >
                {signatureMode === "text" && signatureText.trim() && (
                  <div style={getSignatureStyle()}>
                    {signatureText}
                  </div>
                )}
                {signatureMode === "image" && signatureImage && (
                  <img 
                    src={signatureImage}
                    alt="Signature"
                    style={getSignatureImageStyle() as any}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
