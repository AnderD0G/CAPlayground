"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import JSZip from "jszip";
import { ArrowLeft, Star, Youtube } from "lucide-react";
import { useEditor } from "./editor-context";
import { getProject, listFiles } from "@/lib/storage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { SubmitWallpaperDialog } from "@/app/wallpapers/SubmitWallpaperDialog";
import { exportProjectAsTendies, type ExportLicense } from "@/lib/editor/export-tendies";

export function ExportDialog() {
  const { doc, flushPersist, cleanupAssets } = useEditor();
  const { toast } = useToast();
  const supabase = getSupabaseBrowserClient();

  const [exportOpen, setExportOpen] = useState(false);
  const [exportingTendies, setExportingTendies] = useState(false);
  const [exportView, setExportView] = useState<"select" | "success">("select");
  const [exportFilename, setExportFilename] = useState("");
  const [exportFormat, setExportFormat] = useState<"ca" | "tendies">("ca");
  const [exportLicense, setExportLicense] = useState<ExportLicense>("none");
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [isSignedIn, setIsSignedIn] = useState(false);
  const requiresLicenseConfirmation = exportLicense !== "none";

  const starMessage = useMemo(() => {
    const messages = [
      "Star this repo, make my day,\nIt helps the app in every way! 🌟",
      "A single star can light the way,\nSupport the code I've built today! 🚀",
      "Drop a star, don't walk away,\nIt keeps this project here to stay! 💪",
      "Give a star, don't delay,\nYou'll make my coder's day! 💫",
      "Star the repo, join the crew,\nIt means a lot, from me to you! 🤝",
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }, [exportView]);

  useEffect(() => {
    if (exportOpen && doc?.meta.name) {
      setExportFilename(doc.meta.name);
    }
  }, [exportOpen, doc?.meta.name]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key === "e") {
        e.preventDefault();
        setExportView("select");
        setExportOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadUser() {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) {
          if (mounted) setIsSignedIn(false);
          return;
        }

        if (mounted) setIsSignedIn(true);

        const meta: any = user.user_metadata || {};
        const name = meta.full_name || meta.name || meta.username || user.email || "";
        if (mounted) setDisplayName(name as string);

        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();
        if (mounted && profile?.username) setUsername(profile.username as string);
      } catch { }
    }
    loadUser();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const exportCA = async (downloadNameOverride?: string): Promise<boolean> => {
    try {
      if (!doc) return false;
      try {
        await flushPersist();
        await cleanupAssets(); // Remove orphaned asset files before export
      } catch { }
      const proj = await getProject(doc.meta.id);
      const baseName =
        (downloadNameOverride && downloadNameOverride.trim()) ||
        proj?.name ||
        doc.meta.name ||
        "Project";
      const nameSafe = baseName.replace(/[^a-z0-9\-_]+/gi, "-");
      const folder = `${proj?.name || doc.meta.name || "Project"}.ca`;
      const allFiles = await listFiles(doc.meta.id, `${folder}/`);
      const outputZip = new JSZip();
      const isGyro = doc.meta.gyroEnabled ?? false;

      if (isGyro) {
        const wallpaperPrefix = `${folder}/Wallpaper.ca/`;
        for (const f of allFiles) {
          let rel: string | null = null;
          if (f.path.startsWith(wallpaperPrefix)) {
            rel = `Wallpaper.ca/${f.path.substring(wallpaperPrefix.length)}`;
          } else {
            rel = null;
          }
          if (!rel) continue;
          if (f.type === "text") {
            outputZip.file(rel, String(f.data));
          } else {
            const buf = f.data as ArrayBuffer;
            outputZip.file(rel, buf);
          }
        }
      } else {
        const backgroundPrefix = `${folder}/Background.ca/`;
        const floatingPrefix = `${folder}/Floating.ca/`;
        for (const f of allFiles) {
          let rel: string | null = null;
          if (f.path.startsWith(backgroundPrefix)) {
            rel = `Background.ca/${f.path.substring(backgroundPrefix.length)}`;
          } else if (f.path.startsWith(floatingPrefix)) {
            rel = `Floating.ca/${f.path.substring(floatingPrefix.length)}`;
          } else {
            rel = null;
          }
          if (!rel) continue;
          if (f.type === "text") {
            outputZip.file(rel, String(f.data));
          } else {
            const buf = f.data as ArrayBuffer;
            outputZip.file(rel, buf);
          }
        }
      }

      const licenseText = await loadLicenseText(exportLicense);
      if (licenseText) {
        outputZip.file("LICENSE.txt", licenseText);
      }

      const finalZipBlob = await outputZip.generateAsync({ type: "blob" });

      const url = URL.createObjectURL(finalZipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nameSafe}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error("Export failed", e);
      toast({
        title: "Export failed",
        description: "Failed to export .ca file. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  };

  const exportTendies = async (downloadNameOverride?: string): Promise<boolean> => {
    try {
      setExportingTendies(true);
      if (!doc) return false;
      const { filename } = await exportProjectAsTendies({
        projectId: doc.meta.id,
        projectName: doc.meta.name,
        gyroEnabled: doc.meta.gyroEnabled,
        flushPersist,
        cleanupAssets,
        downloadNameOverride,
        exportLicense,
      });

      toast({
        title: "Export successful",
        description: `Tendies file "${filename}" has been downloaded.`,
      });
      return true;
    } catch (e) {
      console.error("Tendies export failed", e);
      toast({
        title: "Export failed",
        description: "Failed to export tendies file. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setExportingTendies(false);
    }
  };

  return (
    <div>
      <Button
        variant="secondary"
        disabled={!doc}
        onClick={() => {
          setExportView("select");
          setExportOpen(true);
        }}
        className="px-3 sm:px-4 no-compact"
      >
        Export
      </Button>
      <Dialog
        open={exportOpen}
        onOpenChange={(v) => {
          setExportOpen(v);
          if (!v) setExportView("select");
        }}
      >
        <DialogContent className="sm:max-w-md p-4">
          <DialogHeader
            className={`${exportView === "success"
                ? "flex items-center justify-start py-1"
                : "py-2"
              }`}
          >
            {exportView === "success" ? (
              <Button
                variant="ghost"
                className="h-8 w-auto px-2 gap-1 self-start"
                onClick={() => setExportView("select")}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            ) : (
              <>
                <DialogTitle>Export</DialogTitle>
                <DialogDescription>
                  Choose a filename, format, and license, then export your project.
                </DialogDescription>
              </>
            )}
          </DialogHeader>
          <div className="relative overflow-hidden">
            <div
              className="flex w-[200%] transition-transform duration-300 ease-out"
              style={{
                transform:
                  exportView === "select" ? "translateX(0%)" : "translateX(-50%)",
              }}
            >
              <div
                className={`w-1/2 px-0 ${exportView === "success" ? "h-0 overflow-hidden" : ""
                  }`}
              >
                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="export-filename">File name</Label>
                    <Input
                      id="export-filename"
                      value={exportFilename}
                      onChange={(e) => setExportFilename(e.target.value)}
                      placeholder={doc?.meta.name || "Project"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="export-format">Format</Label>
                    <ToggleGroup
                      type="single"
                      value={exportFormat}
                      onValueChange={(value) => {
                        if (!value) return;
                        setExportFormat(value as "ca" | "tendies");
                      }}
                      className="w-full"
                      aria-label="Choose export format"
                    >
                      <ToggleGroupItem
                        value="ca"
                        aria-label="Export CA bundle"
                        className="flex-1 text-xs sm:text-sm"
                      >
                        .ca bundle
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="tendies"
                        aria-label="Export tendies file"
                        className="flex-1 text-xs sm:text-sm"
                      >
                        Tendies
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <p className="text-xs text-muted-foreground mt-1">
                      {exportFormat === "ca"
                        ? "Download a .zip containing your Background.ca and Floating.ca files."
                        : "Create a .tendies wallpaper file compatible with Nugget and Pocket Poster."}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="export-license">License</Label>
                    <Select
                      value={exportLicense}
                      onValueChange={(value) =>
                        setExportLicense(value as ExportLicense)
                      }
                    >
                      <SelectTrigger className="w-full" id="export-license">
                        <SelectValue placeholder="Choose a license" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No license</SelectItem>
                        <SelectItem value="cc-by-4.0">CC BY 4.0</SelectItem>
                        <SelectItem value="cc-by-sa-4.0">CC BY-SA 4.0</SelectItem>
                        <SelectItem value="cc-by-nc-4.0">CC BY-NC 4.0</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {exportLicense === "none" &&
                        "No license text is included. You retain all rights; sharing terms are not specified."}
                      {exportLicense === "cc-by-4.0" &&
                        "Requires attribution. Allows sharing and adaptation, including commercial use. Not recommended to allow commercial use."}
                      {exportLicense === "cc-by-sa-4.0" &&
                        "Requires attribution and share-alike. Adaptations must use the same license. Not recommended to allow commercial use."}
                      {exportLicense === "cc-by-nc-4.0" &&
                        "Requires attribution. Non-commercial use only; adaptations are allowed with the same terms. This license is recommended to prevent work from being sold."}
                    </p>
                  </div>
                  <div className="space-y-2 pt-2">
                    {requiresLicenseConfirmation ? (
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="export-confirmation"
                          checked={exportConfirmed}
                          onCheckedChange={(checked) =>
                            setExportConfirmed(checked === true)
                          }
                          aria-invalid={!exportConfirmed}
                        />
                        <label
                          htmlFor="export-confirmation"
                          className="text-xs text-muted-foreground leading-snug cursor-pointer select-none"
                        >
                          I confirm that I created or have permission to use all content in this wallpaper and that I grant the selected license to the exported file.
                        </label>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground leading-snug">
                        By exporting, you confirm that you created or have permission to use all content in this wallpaper.
                      </p>
                    )}
                    <Button
                      className="w-full"
                      disabled={
                        !doc ||
                        exportingTendies ||
                        (requiresLicenseConfirmation && !exportConfirmed)
                      }
                      onClick={async () => {
                        if (!doc) return;
                        if (requiresLicenseConfirmation && !exportConfirmed) return;
                        const base =
                          exportFilename.trim() || doc.meta.name || "Project";
                        if (exportFormat === "ca") {
                          const ok = await exportCA(base);
                          if (ok) setExportView("success");
                        } else {
                          const ok = await exportTendies(base);
                          if (ok) setExportView("success");
                        }
                      }}
                    >
                      {exportFormat === "ca"
                        ? "Export .ca"
                        : exportingTendies
                          ? "Exporting tendies…"
                          : "Export tendies"}
                    </Button>
                  </div>
                </div>
              </div>
              <div
                className={`w-1/2 px-0 ${exportView === "select" ? "h-0 overflow-hidden" : ""
                  }`}
              >
                <div className="pt-0 pb-4 flex flex-col items-center text-center gap-2.5">
                  <div className="text-2xl font-semibold">
                    Thank you for using CAPlayground!
                  </div>
                  <div className="text-sm text-muted-foreground">
                    What should I do next?
                  </div>
                  <div className="w-full max-w-md text-left space-y-3 text-sm sm:text-base">
                    <div className="flex gap-3 border rounded-md px-4 py-3">
                      <div className="font-medium">1.</div>
                      <div className="space-y-1">
                        <div className="font-medium">Watch video</div>
                        <div>Watch the video on how to use Pocket Poster or Nugget.</div>
                        <a
                          href="https://www.youtube.com/watch?v=nSBQIwAaAEc"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          <Youtube className="h-4 w-4" />
                          Watch the video
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-3 border rounded-md px-4 py-3">
                      <div className="font-medium">2.</div>
                      <div className="space-y-1">
                        <div className="font-medium">Test your wallpaper</div>
                        <div>Apply the wallpaper to your device and test it.</div>
                      </div>
                    </div>
                    <div className="flex gap-3 border rounded-md px-4 py-3">
                      <div className="font-medium">3.</div>
                      <div className="space-y-1">
                        <div className="font-medium">Showcase your work (Optional)</div>
                        <div>Submit the wallpaper if you want to showcase your work.</div>
                        <button
                          type="button"
                          onClick={() => setIsSubmitDialogOpen(true)}
                          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          Submit wallpaper
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <a
                      href="https://github.com/CAPlayground/CAPlayground"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                      <Star className="h-4 w-4" />
                      Star the repo
                    </a>
                    <Button
                      variant="default"
                      className="text-sm"
                      onClick={() => setExportOpen(false)}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <SubmitWallpaperDialog
        open={isSubmitDialogOpen}
        onOpenChange={setIsSubmitDialogOpen}
        username={username || displayName || "Anonymous"}
        isSignedIn={isSignedIn}
      />
    </div>
  );
}
