"use client";

import React, { useMemo, useRef, useState } from "react";
import type { AnyLayer } from "@/lib/ca/types";
import { useEditor } from "@/components/editor/editor-context";
import { useCanvasSize } from "@/hooks/use-canvas-size";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { applyOverrides } from "@/components/editor/canvas-preview/utils/layerApplication";
import { getRootFlip } from "@/components/editor/canvas-preview/utils/coordinates";
import { LayerRenderer } from "@/components/editor/inspector/canvas/LayerRenderer";
import DevicePreview from "@/components/editor/device-preview/DevicePreview";
import Moveable from "react-moveable";

interface RecordingDevicePreviewProps {
  scale: number;
  controlledPhoneState?: "Locked" | "Unlock" | "Sleep";
  disableInteractions?: boolean;
}

export function RecordingDevicePreview({
  scale,
  controlledPhoneState,
  disableInteractions = false,
}: RecordingDevicePreviewProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const moveableRef = useRef<Moveable | null>(null);
  const size = useCanvasSize(stageRef);
  const { doc, hiddenLayerIds } = useEditor();
  const [showBackground] = useLocalStorage<boolean>("caplay_preview_show_background", true);
  const [previewLayers, setPreviewLayers] = useState<AnyLayer[] | null>(null);

  const fitScale = useMemo(() => {
    const w = doc?.meta.width ?? 390;
    const h = doc?.meta.height ?? 844;
    const pad = 32;
    const maxW = Math.max(size.w - pad * 2, 1);
    const maxH = Math.max(size.h - pad * 2, 1);
    const s = Math.min(maxW / w, maxH / h);
    return s > 0 && Number.isFinite(s) ? s : 1;
  }, [size.w, size.h, doc?.meta.width, doc?.meta.height]);

  const currentKey = doc?.activeCA ?? "floating";
  const current = doc?.docs?.[currentKey];
  const otherKey = currentKey === "floating" ? "background" : "floating";
  const other = doc?.docs?.[otherKey];

  const appliedLayers = useMemo(() => {
    if (!current) return [] as AnyLayer[];
    return applyOverrides(current.layers, current.stateOverrides, current.activeState);
  }, [current?.layers, current?.stateOverrides, current?.activeState]);

  const backgroundLayers = useMemo(() => {
    if (!other || currentKey !== "floating" || !showBackground) return [] as AnyLayer[];
    const src = current?.activeState;
    let effective: string | undefined = other.activeState;
    if (src && src !== "Base State") {
      const isVariant = /\s(Light|Dark)$/.test(String(src));
      const base = String(src).replace(/\s(Light|Dark)$/, "");
      const otherStates = Array.isArray(other.states) ? other.states : [];
      const split = !!other.appearanceSplit;
      const mode: "light" | "dark" = other.appearanceMode === "dark" ? "dark" : "light";
      if (isVariant) {
        if (otherStates.includes(src)) {
          effective = src;
        } else if (split) {
          const light = `${base} Light`;
          const dark = `${base} Dark`;
          effective = otherStates.includes(light) ? light : otherStates.includes(dark) ? dark : base;
        } else {
          effective = base;
        }
      } else if (split) {
        const suffix = mode === "dark" ? "Dark" : "Light";
        const candidate = `${base} ${suffix}`;
        effective = otherStates.includes(candidate) ? candidate : base;
      } else {
        effective = base;
      }
    }
    return applyOverrides(other.layers, other.stateOverrides, effective);
  }, [other?.layers, other?.stateOverrides, other?.activeState, other?.states, other?.appearanceSplit, other?.appearanceMode, current?.activeState, currentKey, showBackground]);

  const renderedLayers = useMemo(() => {
    if (previewLayers) return previewLayers;
    if (currentKey === "floating" && showBackground && backgroundLayers.length > 0) {
      return [...backgroundLayers, ...appliedLayers];
    }
    return appliedLayers;
  }, [appliedLayers, backgroundLayers, currentKey, showBackground, previewLayers]);

  if (!doc) {
    return <div className="text-sm text-muted-foreground">Loading project...</div>;
  }

  return (
    <div ref={stageRef} className="h-full w-full">
      <DevicePreview
        showPreview={true}
        setPreviewLayers={setPreviewLayers}
        scale={fitScale * scale}
        stageStyle={{ background: "transparent" }}
        controlledPhoneState={controlledPhoneState}
        disableInteractions={disableInteractions}
      >
        <div
          id="root-canvas"
          className="absolute"
          style={{
            width: doc.meta.width,
            height: doc.meta.height,
            background: doc.meta.background ?? "#f3f4f6",
            transform: "scale(1)",
            transformOrigin: "top left",
            borderRadius: 0,
            overflow: "hidden",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.05), 0 10px 30px rgba(0,0,0,0.08)",
            pointerEvents: "none",
          }}
        >
          {currentKey === "floating" && showBackground ? (
            <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
              {renderedLayers.slice(0, backgroundLayers.length).map((layer) => (
                <LayerRenderer
                  key={layer.id}
                  layer={layer}
                  useYUp={getRootFlip(doc?.meta.geometryFlipped) === 0}
                  siblings={renderedLayers}
                  gyroX={0}
                  gyroY={0}
                  useGyroControls={false}
                  hiddenLayerIds={hiddenLayerIds}
                  moveableRef={moveableRef}
                  disableHitTesting
                />
              ))}
            </div>
          ) : currentKey === "background" ? (
            <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
              {renderedLayers.map((layer) => (
                <LayerRenderer
                  key={layer.id}
                  layer={layer}
                  useYUp={getRootFlip(doc?.meta.geometryFlipped) === 0}
                  siblings={renderedLayers}
                  gyroX={0}
                  gyroY={0}
                  useGyroControls={false}
                  hiddenLayerIds={hiddenLayerIds}
                  moveableRef={moveableRef}
                  disableHitTesting
                />
              ))}
            </div>
          ) : currentKey === "wallpaper" ? (
            <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
              <div id="lock-screen-clock" className="pt-[35px]" />
              {renderedLayers
                .filter((layer) => ["FLOATING", "BACKGROUND"].includes(layer.name))
                .map((layer) => (
                  <LayerRenderer
                    key={layer.id}
                    layer={layer}
                    useYUp={getRootFlip(doc?.meta.geometryFlipped) === 0}
                    siblings={renderedLayers}
                    gyroX={0}
                    gyroY={0}
                    useGyroControls={false}
                    hiddenLayerIds={hiddenLayerIds}
                    moveableRef={moveableRef}
                    disableHitTesting
                  />
                ))}
            </div>
          ) : null}
          {currentKey === "floating" && (
            <div style={{ position: "absolute", inset: 0, zIndex: 100 }}>
              <div id="lock-screen-clock" className="pt-[35px]" />
              {(showBackground ? renderedLayers.slice(backgroundLayers.length) : renderedLayers).map((layer) => (
                <LayerRenderer
                  key={layer.id}
                  layer={layer}
                  useYUp={getRootFlip(doc?.meta.geometryFlipped) === 0}
                  siblings={renderedLayers}
                  gyroX={0}
                  gyroY={0}
                  useGyroControls={false}
                  hiddenLayerIds={hiddenLayerIds}
                  moveableRef={moveableRef}
                  disableHitTesting
                />
              ))}
            </div>
          )}
        </div>
      </DevicePreview>
    </div>
  );
}
