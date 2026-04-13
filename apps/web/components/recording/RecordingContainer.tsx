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
  loop: boolean;
}

export function RecordingContainer({ onBackClick }: RecordingContainerProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<VideoRecorder | null>(null);
  const autoSequenceTimeoutsRef = useRef<number[]>([]);

  // 背景配置
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("checkerboard");
  const [backgroundColor, setBackgroundColor] = useState("#f3f4f6");
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  // 录制模式
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("manual");

  // 自动播放配置
  const [autoPlayConfig, setAutoPlayConfig] = useState<AutoPlayConfig>({
    sleepDuration: 2,
    unlockDuration: 2,
    lockDuration: 2,
    loop: true,
  });

  // 录制状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [controlledPhoneState, setControlledPhoneState] = useState<"Locked" | "Unlock" | "Sleep" | undefined>(undefined);
  const [exportFilename, setExportFilename] = useState(
    `recording-${new Date().getTime()}.webm`
  );

  const clearAutoSequence = () => {
    for (const timeoutId of autoSequenceTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    autoSequenceTimeoutsRef.current = [];
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
    if (!canvasRef.current) {
      toast({ title: "Error", description: "Canvas not found", variant: "destructive" });
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
      recorderRef.current = new VideoRecorder({
        canvas: canvasRef.current,
        fps: 30,
        videoBitsPerSecond: 5000000,
        onProgress: setRecordingProgress,
      });

      await recorderRef.current.start();

      // 如果是自动模式，自动播放动画
      if (recordingMode === "auto") {
        runAutoPlaySequence();
      } else {
        setControlledPhoneState(undefined);
      }

      toast({ title: "Recording started", description: "Started recording your presentation" });
    } catch (error) {
      console.error("Failed to start recording:", error);
      toast({
        title: "Error",
        description: "Failed to start recording",
        variant: "destructive",
      });
      setIsRecording(false);
    }
  };

  // 自动播放序列
  const runAutoPlaySequence = async (): Promise<void> => {
    clearAutoSequence();

    const sleepMs = autoPlayConfig.sleepDuration * 1000;
    const unlockMs = autoPlayConfig.unlockDuration * 1000;
    const lockMs = autoPlayConfig.lockDuration * 1000;
    const cycleMs = sleepMs + unlockMs + lockMs;

    const runCycle = () => {
      setControlledPhoneState("Sleep");

      autoSequenceTimeoutsRef.current.push(
        window.setTimeout(() => {
          setControlledPhoneState("Unlock");
        }, sleepMs)
      );

      autoSequenceTimeoutsRef.current.push(
        window.setTimeout(() => {
          setControlledPhoneState("Locked");
        }, sleepMs + unlockMs)
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
      setControlledPhoneState(undefined);
      const blob = await recorderRef.current.stop();
      setIsRecording(false);

      // 导出视频
      await VideoRecorder.exportVideo(blob, exportFilename);

      toast({
        title: "Success",
        description: `Video exported as ${exportFilename}`,
      });
    } catch (error) {
      console.error("Failed to stop recording:", error);
      toast({
        title: "Error",
        description: "Failed to export video",
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
                  <Label className="text-sm">Unlock Duration (s)</Label>
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
                  <Label className="text-sm">Lock Duration (s)</Label>
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

          {/* 导出设置 */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Export</h3>
            <div>
              <Label className="text-sm">Filename</Label>
              <Input
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder="recording.webm"
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
          <div className="relative">
            <RecordingDevicePreview
              scale={0.5}
              controlledPhoneState={recordingMode === "auto" ? controlledPhoneState : undefined}
              disableInteractions={recordingMode === "auto"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
