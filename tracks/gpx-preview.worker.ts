import { previewGpxUpload, GPX_LIMITS } from "./gpx-preview";
import { TrackError } from "./validation";

// File reading and bounded XML scanning both stay off the browser's UI thread.
self.onmessage = async ({
  data,
}: MessageEvent<{ file: File; title: string }>) => {
  try {
    if (data.file.size > GPX_LIMITS.bytes) throw new TrackError("tooLarge");
    const title = data.title.trim();
    if (!title || Array.from(title).length > 200 || title.includes("\0"))
      throw new TrackError("invalidMetadata");
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    self.postMessage({ preview: previewGpxUpload(bytes, title) });
  } catch (cause) {
    const error =
      cause instanceof TrackError ? cause : new TrackError("invalidFile");
    self.postMessage({
      error: { code: error.code, track: error.track, segment: error.segment },
    });
  }
};
