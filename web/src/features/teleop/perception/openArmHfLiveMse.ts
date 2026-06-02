import {
  OPENARM_HF_LIVE_AV1_EIGHT_BIT,
  OPENARM_HF_LIVE_AV1_HIGH_BIT_DEPTH_SHIFT,
  OPENARM_HF_LIVE_AV1_LEVEL_MASK,
  OPENARM_HF_LIVE_AV1_PROFILE_MASK,
  OPENARM_HF_LIVE_AV1_PROFILE_SHIFT,
  OPENARM_HF_LIVE_AV1_TEN_BIT,
  OPENARM_HF_LIVE_AV1_TIER_SHIFT,
  OPENARM_HF_LIVE_AV1_TWELVE_BIT,
  OPENARM_HF_LIVE_AV1_TWELVE_BIT_SHIFT,
  OPENARM_HF_LIVE_AV1C_PAYLOAD_OFFSET,
  OPENARM_HF_LIVE_AVC_CODEC_BYTES,
  OPENARM_HF_LIVE_BOX_HEADER_BYTES,
  OPENARM_HF_LIVE_BOX_MIN_SIZE,
  OPENARM_HF_LIVE_BOX_TYPE_OFFSET,
  OPENARM_HF_LIVE_CODEC_SCAN_TRAILING_BYTES,
  OPENARM_HF_LIVE_FIRST_MEDIA_BOX_SCAN_START,
  OPENARM_HF_LIVE_MSE_MAX_BUFFER_SECONDS,
  OPENARM_HF_LIVE_MSE_QUEUE_KEEP_SEGMENTS,
  OPENARM_HF_LIVE_MSE_REMOVE_KEEP_SECONDS,
  OPENARM_HF_LIVE_MSE_SEEK_LAG_SECONDS,
  OPENARM_HF_LIVE_MSE_TARGET_LAG_SECONDS,
  OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES,
} from "@/features/teleop/perception/openArmHfLiveParams";

const MP4_BOX_TYPES = {
  ftyp: "ftyp",
  moof: "moof",
  styp: "styp",
  av1C: "av1C",
  avcC: "avcC",
} as const;

type CapturableHtmlVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
};

const toAppendableBuffer = (segment: Uint8Array): ArrayBuffer =>
  segment.buffer instanceof ArrayBuffer
    ? segment.buffer.slice(segment.byteOffset, segment.byteOffset + segment.byteLength)
    : new Uint8Array(segment).buffer;

const getBoxType = (data: Uint8Array, offset: number): string =>
  String.fromCharCode(
    data[offset + OPENARM_HF_LIVE_BOX_TYPE_OFFSET],
    data[offset + OPENARM_HF_LIVE_BOX_TYPE_OFFSET + 1],
    data[offset + OPENARM_HF_LIVE_BOX_TYPE_OFFSET + 2],
    data[offset + OPENARM_HF_LIVE_BOX_TYPE_OFFSET + 3]
  );

const getBoxSize = (data: Uint8Array, offset: number): number =>
  (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];

const isBoxAt = (data: Uint8Array, offset: number, boxType: string): boolean =>
  data.length >= offset + OPENARM_HF_LIVE_BOX_HEADER_BYTES && getBoxType(data, offset) === boxType;

const isFtypSegment = (data: Uint8Array): boolean => isBoxAt(data, 0, MP4_BOX_TYPES.ftyp);

const hasTimestampPrefix = (data: Uint8Array): boolean =>
  data.length >= OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES + OPENARM_HF_LIVE_BOX_HEADER_BYTES &&
  !isFtypSegment(data) &&
  (isBoxAt(data, OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES, MP4_BOX_TYPES.ftyp) ||
    isBoxAt(data, OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES, MP4_BOX_TYPES.moof) ||
    isBoxAt(data, OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES, MP4_BOX_TYPES.styp));

export const stripOpenArmHfTimestampPrefix = (data: Uint8Array): Uint8Array =>
  hasTimestampPrefix(data) ? data.subarray(OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES) : data;

const findFirstMediaBoxOffset = (data: Uint8Array): number => {
  let offset = OPENARM_HF_LIVE_FIRST_MEDIA_BOX_SCAN_START;
  while (offset + OPENARM_HF_LIVE_BOX_HEADER_BYTES <= data.length) {
    const boxSize = getBoxSize(data, offset);
    const boxType = getBoxType(data, offset);
    if (boxType === MP4_BOX_TYPES.styp || boxType === MP4_BOX_TYPES.moof) return offset;
    if (boxSize < OPENARM_HF_LIVE_BOX_MIN_SIZE) break;
    offset += boxSize;
  }
  return OPENARM_HF_LIVE_FIRST_MEDIA_BOX_SCAN_START;
};

export const findOpenArmHfMp4BoxPayload = (
  data: Uint8Array,
  boxType: string
): Uint8Array | null => {
  let offset = OPENARM_HF_LIVE_FIRST_MEDIA_BOX_SCAN_START;
  while (offset + OPENARM_HF_LIVE_BOX_HEADER_BYTES <= data.length) {
    const boxSize = getBoxSize(data, offset);
    if (getBoxType(data, offset) === boxType) {
      return data.subarray(offset + OPENARM_HF_LIVE_BOX_HEADER_BYTES, offset + boxSize);
    }
    if (boxSize < OPENARM_HF_LIVE_BOX_MIN_SIZE) break;
    offset += boxSize;
  }
  return null;
};

export const findOpenArmHfMp4BoxOffset = (
  data: Uint8Array,
  boxType: string
): number => {
  let offset = OPENARM_HF_LIVE_FIRST_MEDIA_BOX_SCAN_START;
  while (offset + OPENARM_HF_LIVE_BOX_HEADER_BYTES <= data.length) {
    const boxSize = getBoxSize(data, offset);
    if (getBoxType(data, offset) === boxType) return offset;
    if (boxSize < OPENARM_HF_LIVE_BOX_MIN_SIZE) break;
    offset += boxSize;
  }
  return -1;
};

const toHexByte = (value: number): string => value.toString(16).padStart(2, "0").toUpperCase();

export const detectOpenArmHfMp4Codec = (data: Uint8Array): string | null => {
  for (let offset = 0; offset < data.length - OPENARM_HF_LIVE_CODEC_SCAN_TRAILING_BYTES; offset += 1) {
    if (isBoxAt(data, offset, MP4_BOX_TYPES.avcC)) {
      const payloadOffset = offset + OPENARM_HF_LIVE_AV1C_PAYLOAD_OFFSET;
      if (payloadOffset + OPENARM_HF_LIVE_AVC_CODEC_BYTES < data.length) {
        return `avc1.${toHexByte(data[payloadOffset + 1])}${toHexByte(
          data[payloadOffset + 2]
        )}${toHexByte(data[payloadOffset + 3])}`;
      }
    }
    if (isBoxAt(data, offset, MP4_BOX_TYPES.av1C)) {
      const payloadOffset = offset + OPENARM_HF_LIVE_AV1C_PAYLOAD_OFFSET;
      if (payloadOffset + OPENARM_HF_LIVE_AVC_CODEC_BYTES <= data.length) {
        const profile = (data[payloadOffset + 1] >> OPENARM_HF_LIVE_AV1_PROFILE_SHIFT) & OPENARM_HF_LIVE_AV1_PROFILE_MASK;
        const level = data[payloadOffset + 1] & OPENARM_HF_LIVE_AV1_LEVEL_MASK;
        const tier = (data[payloadOffset + 2] >> OPENARM_HF_LIVE_AV1_TIER_SHIFT) & 1;
        const highBitDepth = (data[payloadOffset + 2] >> OPENARM_HF_LIVE_AV1_HIGH_BIT_DEPTH_SHIFT) & 1;
        const twelveBit = (data[payloadOffset + 2] >> OPENARM_HF_LIVE_AV1_TWELVE_BIT_SHIFT) & 1;
        const bitDepth = highBitDepth
          ? twelveBit
            ? OPENARM_HF_LIVE_AV1_TWELVE_BIT
            : OPENARM_HF_LIVE_AV1_TEN_BIT
          : OPENARM_HF_LIVE_AV1_EIGHT_BIT;
        return `av01.${profile}.${String(level).padStart(2, "0")}${tier ? "H" : "M"}.${String(
          bitDepth
        ).padStart(2, "0")}`;
      }
    }
  }
  return null;
};

export class OpenArmHfMseVideoTrack {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private readonly queue: Uint8Array[] = [];
  private ready = false;
  private started = false;
  private objectUrl: string | null = null;

  constructor(private readonly video: HTMLVideoElement) {
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
  }

  get stream(): MediaStream | null {
    const captureStream = (this.video as CapturableHtmlVideoElement).captureStream?.bind(this.video);
    return captureStream ? captureStream() : null;
  }

  onData(data: Uint8Array): void {
    let segment = stripOpenArmHfTimestampPrefix(data);
    if (!this.started) {
      if (!isFtypSegment(segment)) {
        this.queue.push(segment);
        return;
      }
      this.start(segment);
      return;
    }
    if (isFtypSegment(segment)) {
      const mediaOffset = findFirstMediaBoxOffset(segment);
      if (mediaOffset > 0) segment = segment.subarray(mediaOffset);
    }
    this.enqueue(segment);
  }

  destroy(): void {
    this.queue.length = 0;
    this.ready = false;
    this.started = false;
    if (this.mediaSource?.readyState === "open") {
      try {
        this.mediaSource.endOfStream();
      } catch {
        // Best effort cleanup for a live source.
      }
    }
    this.sourceBuffer = null;
    this.mediaSource = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private start(initSegment: Uint8Array): void {
    const mediaSourceCtor = window.MediaSource || window.ManagedMediaSource;
    const codec = detectOpenArmHfMp4Codec(initSegment);
    if (!mediaSourceCtor || !codec) {
      throw new Error("OpenArm live video cannot detect a browser-supported MP4 codec.");
    }
    const mimeType = `video/mp4; codecs="${codec}"`;
    if (!mediaSourceCtor.isTypeSupported(mimeType)) {
      throw new Error(`OpenArm live video codec is not supported by this browser: ${mimeType}`);
    }

    this.started = true;
    this.mediaSource = new mediaSourceCtor();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this.objectUrl;
    this.mediaSource.addEventListener("sourceopen", () => {
      if (!this.mediaSource) return;
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
      this.sourceBuffer.mode = "segments";
      this.sourceBuffer.addEventListener("updateend", () => this.flush());
      this.ready = true;
      this.queue.unshift(initSegment);
      this.flush();
      void this.video.play();
    });
  }

  private enqueue(segment: Uint8Array): void {
    this.queue.push(segment);
    if (this.queue.length > OPENARM_HF_LIVE_MSE_QUEUE_KEEP_SEGMENTS) {
      this.queue.splice(1, this.queue.length - OPENARM_HF_LIVE_MSE_QUEUE_KEEP_SEGMENTS);
    }
    this.flush();
  }

  private flush(): void {
    if (!this.ready || !this.sourceBuffer || this.sourceBuffer.updating) return;
    if (this.video.buffered.length > 0) {
      const start = this.video.buffered.start(0);
      const end = this.video.buffered.end(this.video.buffered.length - 1);
      if (end - start > OPENARM_HF_LIVE_MSE_MAX_BUFFER_SECONDS) {
        try {
          this.sourceBuffer.remove(start, end - OPENARM_HF_LIVE_MSE_REMOVE_KEEP_SECONDS);
        } catch {
          // Ignore remove races while the live buffer is updating.
        }
        return;
      }
      if (
        this.video.currentTime < start ||
        end - this.video.currentTime > OPENARM_HF_LIVE_MSE_SEEK_LAG_SECONDS
      ) {
        this.video.currentTime = Math.max(start, end - OPENARM_HF_LIVE_MSE_TARGET_LAG_SECONDS);
      }
    }
    const next = this.queue.shift();
    if (!next) return;
    try {
      this.sourceBuffer.appendBuffer(toAppendableBuffer(next));
    } catch {
      this.queue.unshift(next);
    }
  }
}

declare global {
  interface Window {
    ManagedMediaSource?: typeof MediaSource;
  }
}
