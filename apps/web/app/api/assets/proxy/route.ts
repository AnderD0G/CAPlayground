import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function isBlockedHostname(hostname: string) {
  const value = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(value)) return true;
  if (/^10\./.test(value)) return true;
  if (/^192\.168\./.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  if (/^169\.254\./.test(value)) return true;
  if (/^fc00:/i.test(value) || /^fd00:/i.test(value) || /^fe80:/i.test(value)) return true;
  return false;
}

function guessFilename(url: URL, contentType: string | null) {
  const rawName = url.pathname.split("/").pop() || "image";
  const safeBase = rawName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "image";
  if (/\.[a-z0-9]+$/i.test(safeBase)) return safeBase;

  const ext = contentType?.includes("png")
    ? ".png"
    : contentType?.includes("jpeg")
      ? ".jpg"
      : contentType?.includes("webp")
        ? ".webp"
        : contentType?.includes("gif")
          ? ".gif"
          : ".bin";
  return `${safeBase}${ext}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!rawUrl) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const target = new URL(rawUrl);
    if (!["http:", "https:"].includes(target.protocol)) {
      return NextResponse.json({ error: "Only http and https URLs are supported" }, { status: 400 });
    }
    if (isBlockedHostname(target.hostname)) {
      return NextResponse.json({ error: "Private network URLs are not allowed" }, { status: 400 });
    }

    const response = await fetch(target, {
      method: "GET",
      headers: {
        "User-Agent": "CAPlayground Asset Proxy",
        Accept: "image/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Upstream request failed with ${response.status}` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Upstream response is not an image" }, { status: 415 });
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image is too large" }, { status: 413 });
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image is too large" }, { status: 413 });
    }

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-File-Name": guessFilename(target, contentType),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to proxy asset" },
      { status: 500 },
    );
  }
}