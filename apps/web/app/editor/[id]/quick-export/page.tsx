"use client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, ImagePlus, Link2, Loader2, Sparkles } from "lucide-react";

import { EditorProvider, useEditor } from "@/components/editor/editor-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAssetUrl } from "@/hooks/use-asset-url";
import { getProject } from "@/lib/storage";
import { exportProjectAsTendies } from "@/lib/editor/export-tendies";
import { normalize } from "@/lib/editor/file-utils";
import type { AnyLayer } from "@/lib/ca/types";
import type { ProjectDocument } from "@/components/editor/editor-context";

type QuickMeta = { id: string; name: string; width: number; height: number; background?: string };
type CAView = ProjectDocument["activeCA"];

type ImageEntry = {
  view: CAView;
  id: string;
  name: string;
  src: string;
};

type BatchInstruction = {
  target: string;
  url: string;
  view?: CAView;
};

const VIEW_LABELS: Record<CAView, string> = {
  floating: "Floating",
  background: "Background",
  wallpaper: "Wallpaper",
};

function collectImageLayers(doc: ProjectDocument | null): ImageEntry[] {
  if (!doc) return [];

  const entries: ImageEntry[] = [];
  const walk = (view: CAView, layers: AnyLayer[]) => {
    for (const layer of layers) {
      if (layer.type === "image" && typeof layer.src === "string" && layer.src) {
        entries.push({
          view,
          id: layer.id,
          name: layer.name || layer.id,
          src: layer.src,
        });
      }
      if (Array.isArray(layer.children) && layer.children.length > 0) {
        walk(view, layer.children);
      }
    }
  };

  walk("background", doc.docs.background.layers);
  walk("floating", doc.docs.floating.layers);
  walk("wallpaper", doc.docs.wallpaper.layers);

  return entries;
}

function parseBatchInstructions(input: string): BatchInstruction[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => ({
      target: String(item?.target || item?.id || item?.name || "").trim(),
      url: String(item?.url || "").trim(),
      view: item?.view,
    }));
  }

  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed).map(([target, value]) => {
      if (typeof value === "string") {
        return { target: target.trim(), url: value.trim() };
      }
      return {
        target: target.trim(),
        url: String((value as { url?: string })?.url || "").trim(),
        view: (value as { view?: CAView })?.view,
      };
    });
  }

  throw new Error("Invalid batch JSON");
}

function matchTargets(images: ImageEntry[], instruction: BatchInstruction) {
  const target = instruction.target.trim();
  if (!target) return [];

  const byId = images.filter((image) => image.id === target && (!instruction.view || image.view === instruction.view));
  if (byId.length > 0) return byId;

  const normalizedTarget = normalize(target);
  return images.filter((image) => {
    if (instruction.view && image.view !== instruction.view) return false;
    return normalize(image.name) === normalizedTarget;
  });
}

async function fetchRemoteImageFile(url: string) {
  const response = await fetch("/api/assets/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    let message = `Failed to fetch image (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {}
    throw new Error(message);
  }

  const blob = await response.blob();
  const fileName = response.headers.get("X-File-Name") || "image";
  return new File([blob], fileName, { type: blob.type || "application/octet-stream" });
}

function QuickImageCard({
  image,
  url,
  busy,
  onUrlChange,
  onApplyUrl,
  onFileChange,
}: {
  image: ImageEntry;
  url: string;
  busy: boolean;
  onUrlChange: (value: string) => void;
  onApplyUrl: () => Promise<void>;
  onFileChange: (file: File) => Promise<void>;
}) {
  const { src } = useAssetUrl({
    cacheKey: image.id,
    assetSrc: image.src,
  });

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{image.name}</CardTitle>
            <CardDescription className="mt-1 break-all text-xs">{image.id}</CardDescription>
          </div>
          <Badge variant="outline">{VIEW_LABELS[image.view]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 px-4 md:grid-cols-[180px_1fr]">
        <div className="overflow-hidden rounded-lg border bg-muted/30">
          {src ? (
            <img src={src} alt={image.name} className="h-44 w-full object-contain" />
          ) : (
            <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">No preview</div>
          )}
        </div>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor={`url-${image.id}`}>Image URL</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`url-${image.id}`}
                value={url}
                placeholder="https://example.com/image.png"
                onChange={(event) => onUrlChange(event.target.value)}
                disabled={busy}
              />
              <Button type="button" onClick={() => void onApplyUrl()} disabled={busy || !url.trim()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                Apply URL
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`file-${image.id}`}>Upload file</Label>
            <Input
              id={`file-${image.id}`}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp,image/svg+xml"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void onFileChange(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickExportWorkspace() {
  const router = useRouter();
  const { toast } = useToast();
  const { doc, flushPersist, cleanupAssets, replaceImageForLayerInView } = useEditor();

  const images = useMemo(() => collectImageLayers(doc), [doc]);
  const [urlByLayerId, setUrlByLayerId] = useState<Record<string, string>>({});
  const [batchJson, setBatchJson] = useState(`[
  {
    "target": "layer-id-or-name",
    "url": "https://example.com/new-image.png"
  }
]`);
  const [busyLayerId, setBusyLayerId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleReplaceByUrl = async (image: ImageEntry) => {
    const url = (urlByLayerId[image.id] || "").trim();
    if (!url) return;

    try {
      setBusyLayerId(image.id);
      const file = await fetchRemoteImageFile(url);
      await replaceImageForLayerInView(image.view, image.id, file);
      toast({
        title: "Image replaced",
        description: `${image.name} updated from URL.`,
      });
    } catch (error) {
      toast({
        title: "Replace failed",
        description: error instanceof Error ? error.message : "Failed to replace image.",
        variant: "destructive",
      });
    } finally {
      setBusyLayerId(null);
    }
  };

  const handleReplaceByFile = async (image: ImageEntry, file: File) => {
    try {
      setBusyLayerId(image.id);
      await replaceImageForLayerInView(image.view, image.id, file);
      toast({
        title: "Image replaced",
        description: `${image.name} updated from local file.`,
      });
    } catch (error) {
      toast({
        title: "Replace failed",
        description: error instanceof Error ? error.message : "Failed to replace image.",
        variant: "destructive",
      });
    } finally {
      setBusyLayerId(null);
    }
  };

  const handleBatchApply = async () => {
    try {
      setBatchRunning(true);
      const instructions = parseBatchInstructions(batchJson).filter((item) => item.target && item.url);
      if (instructions.length === 0) {
        throw new Error("Batch JSON is empty.");
      }

      let applied = 0;
      for (const instruction of instructions) {
        const matches = matchTargets(images, instruction);
        if (matches.length === 0) {
          throw new Error(`No image layer matches target \"${instruction.target}\".`);
        }

        const file = await fetchRemoteImageFile(instruction.url);
        for (const match of matches) {
          await replaceImageForLayerInView(match.view, match.id, file);
          applied += 1;
        }
      }

      toast({
        title: "Batch replace completed",
        description: `${applied} image layer${applied === 1 ? "" : "s"} updated.`,
      });
    } catch (error) {
      toast({
        title: "Batch replace failed",
        description: error instanceof Error ? error.message : "Failed to apply batch replacements.",
        variant: "destructive",
      });
    } finally {
      setBatchRunning(false);
    }
  };

  const handleExport = async () => {
    if (!doc) return;

    try {
      setExporting(true);
      const { filename } = await exportProjectAsTendies({
        projectId: doc.meta.id,
        projectName: doc.meta.name,
        gyroEnabled: doc.meta.gyroEnabled,
        flushPersist,
        cleanupAssets,
      });
      toast({
        title: "Export successful",
        description: `${filename} has been downloaded.`,
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Failed to export tendies file.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  if (!doc) return null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => router.push(`/editor/${doc.meta.id}`)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to editor
              </Button>
              <span>/</span>
              <span>Quick Replace & Export</span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{doc.meta.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Replace image layers from upload or URL, then export a fresh .tendies bundle without opening the full inspector flow.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{images.length} image layers</Badge>
            <Button variant="outline" asChild>
              <Link href={`/editor/${doc.meta.id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open full editor
              </Link>
            </Button>
            <Button onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export .tendies
            </Button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,340px)_1fr]">
          <Card className="gap-4 py-5 xl:sticky xl:top-6 xl:self-start">
            <CardHeader className="px-5">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5" />
                Batch replace
              </CardTitle>
              <CardDescription>
                Paste a JSON map and pull replacement images from public URLs. Match by exact layer id, or by normalized layer name.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 px-5">
              <Label htmlFor="batch-json">Batch JSON</Label>
              <Textarea
                id="batch-json"
                className="min-h-[260px] font-mono text-xs"
                value={batchJson}
                onChange={(event) => setBatchJson(event.target.value)}
                disabled={batchRunning}
              />
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>Supported formats:</p>
                <p>{`[{ "target": "hero", "url": "https://..." }]`}</p>
                <p>{`{ "hero": "https://...", "logo": { "url": "https://...", "view": "floating" } }`}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => void handleBatchApply()} disabled={batchRunning}>
                {batchRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                Apply batch replacements
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {images.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>No image layers found</CardTitle>
                  <CardDescription>This project currently has no image layers to replace.</CardDescription>
                </CardHeader>
              </Card>
            ) : (
              images.map((image) => (
                <QuickImageCard
                  key={`${image.view}:${image.id}`}
                  image={image}
                  url={urlByLayerId[image.id] || ""}
                  busy={busyLayerId === image.id}
                  onUrlChange={(value) => {
                    setUrlByLayerId((prev) => ({ ...prev, [image.id]: value }));
                  }}
                  onApplyUrl={async () => {
                    await handleReplaceByUrl(image);
                  }}
                  onFileChange={async (file) => {
                    await handleReplaceByFile(image, file);
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function QuickExportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params?.id;
  const [meta, setMeta] = useState<QuickMeta | null>(null);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const project = await getProject(projectId);
        if (!project) {
          router.replace("/projects");
          return;
        }

        setMeta({
          id: project.id,
          name: project.name,
          width: project.width ?? 390,
          height: project.height ?? 844,
        });
      } catch {
        router.replace("/projects");
      }
    })();
  }, [projectId, router]);

  if (!projectId || !meta) return null;

  return (
    <EditorProvider projectId={projectId} initialMeta={meta}>
      <QuickExportWorkspace />
    </EditorProvider>
  );
}