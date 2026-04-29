import JSZip from "jszip";

import { getProject, listFiles } from "@/lib/storage";

export type ExportLicense = "none" | "cc-by-4.0" | "cc-by-sa-4.0" | "cc-by-nc-4.0";

async function loadLicenseText(license: ExportLicense): Promise<string | null> {
  if (license === "none") return null;

  const filenameMap: Record<Exclude<ExportLicense, "none">, string> = {
    "cc-by-4.0": "cc-by-4.0.txt",
    "cc-by-sa-4.0": "cc-by-sa-4.0.txt",
    "cc-by-nc-4.0": "cc-by-nc-4.0.txt",
  };

  const filename = filenameMap[license as Exclude<ExportLicense, "none">];
  if (!filename) return null;

  try {
    const resp = await fetch(`/licenses/${filename}`);
    if (!resp.ok) return null;
    const text = await resp.text();
    return text || null;
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportProjectAsTendies({
  projectId,
  projectName,
  gyroEnabled,
  flushPersist,
  cleanupAssets,
  downloadNameOverride,
  exportLicense = "none",
}: {
  projectId: string;
  projectName: string;
  gyroEnabled?: boolean;
  flushPersist?: () => Promise<void>;
  cleanupAssets?: () => Promise<void>;
  downloadNameOverride?: string;
  exportLicense?: ExportLicense;
}): Promise<{ filename: string }> {
  try {
    await flushPersist?.();
    await cleanupAssets?.();
  } catch {}

  const proj = await getProject(projectId);
  const baseName =
    (downloadNameOverride && downloadNameOverride.trim()) ||
    proj?.name ||
    projectName ||
    "Project";
  const nameSafe = baseName.replace(/[^a-z0-9\-_]+/gi, "-");
  const isGyro = gyroEnabled ?? proj?.gyroEnabled ?? false;

  const templateEndpoint = isGyro
    ? "/api/templates/gyro-tendies"
    : "/api/templates/tendies";
  const templateResponse = await fetch(templateEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/zip",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!templateResponse.ok) {
    throw new Error(
      `Failed to fetch tendies template: ${templateResponse.status} ${templateResponse.statusText}`,
    );
  }

  const templateArrayBuffer = await templateResponse.arrayBuffer();

  if (templateArrayBuffer.byteLength === 0) {
    throw new Error("Error with length of tendies file");
  }

  const templateZip = new JSZip();
  await templateZip.loadAsync(templateArrayBuffer);

  const outputZip = new JSZip();

  for (const [relativePath, file] of Object.entries(templateZip.files)) {
    if (!file.dir) {
      const content = await file.async("uint8array");
      outputZip.file(relativePath, content);
    }
  }

  const folder = `${proj?.name || projectName || "Project"}.ca`;
  const allFiles = await listFiles(projectId, `${folder}/`);

  if (isGyro) {
    const wallpaperPrefix = `${folder}/Wallpaper.ca/`;
    const caMap: Array<{ path: string; data: Uint8Array | string }> = [];
    for (const f of allFiles) {
      if (f.path.startsWith(wallpaperPrefix)) {
        caMap.push({
          path: f.path.substring(wallpaperPrefix.length),
          data:
            f.type === "text"
              ? String(f.data)
              : new Uint8Array(f.data as ArrayBuffer),
        });
      }
    }
    const caFolderPath =
      "descriptors/99990000-0000-0000-0000-000000000000/versions/0/contents/7400.WWDC_2022-390w-844h@3x~iphone.wallpaper/wallpaper.ca";
    for (const file of caMap) {
      const fullPath = `${caFolderPath}/${file.path}`;
      if (typeof file.data === "string") outputZip.file(fullPath, file.data);
      else outputZip.file(fullPath, file.data);
    }
  } else {
    const backgroundPrefix = `${folder}/Background.ca/`;
    const floatingPrefix = `${folder}/Floating.ca/`;
    const caMap: Record<
      "background" | "floating",
      Array<{ path: string; data: Uint8Array | string }>
    > = { background: [], floating: [] };
    for (const f of allFiles) {
      if (f.path.startsWith(backgroundPrefix)) {
        caMap.background.push({
          path: f.path.substring(backgroundPrefix.length),
          data:
            f.type === "text"
              ? String(f.data)
              : new Uint8Array(f.data as ArrayBuffer),
        });
      } else if (f.path.startsWith(floatingPrefix)) {
        caMap.floating.push({
          path: f.path.substring(floatingPrefix.length),
          data:
            f.type === "text"
              ? String(f.data)
              : new Uint8Array(f.data as ArrayBuffer),
        });
      }
    }
    const caKeys = ["background", "floating"] as const;
    for (const key of caKeys) {
      const caFolderPath =
        key === "floating"
          ? "descriptors/09E9B685-7456-4856-9C10-47DF26B76C33/versions/1/contents/7400.WWDC_2022-390w-844h@3x~iphone.wallpaper/7400.WWDC_2022_Floating-390w-844h@3x~iphone.ca"
          : "descriptors/09E9B685-7456-4856-9C10-47DF26B76C33/versions/1/contents/7400.WWDC_2022-390w-844h@3x~iphone.wallpaper/7400.WWDC_2022_Background-390w-844h@3x~iphone.ca";
      for (const file of caMap[key]) {
        const fullPath = `${caFolderPath}/${file.path}`;
        if (typeof file.data === "string") outputZip.file(fullPath, file.data);
        else outputZip.file(fullPath, file.data);
      }
    }
  }

  const licenseText = await loadLicenseText(exportLicense);
  if (licenseText) {
    outputZip.file("descriptors/LICENSE.txt", licenseText);
  }

  const finalZipBlob = await outputZip.generateAsync({ type: "blob" });
  const filename = `${nameSafe}.tendies`;
  downloadBlob(finalZipBlob, filename);
  return { filename };
}