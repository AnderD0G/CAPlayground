import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) {
    return ffmpegSingleton;
  }
  if (ffmpegLoadPromise) {
    return ffmpegLoadPromise;
  }

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

export async function transcodeWebMToMp4(blob: Blob): Promise<Blob> {
  const ffmpeg = await getFFmpeg();

  const inputName = "input.webm";
  const outputName = "output.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(blob));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputName,
  ]);

  const outputData = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  if (!(outputData instanceof Uint8Array) || outputData.length === 0) {
    throw new Error("MP4 conversion produced empty output");
  }

  const safeBytes = Uint8Array.from(outputData);
  return new Blob([safeBytes.buffer as ArrayBuffer], { type: "video/mp4" });
}
