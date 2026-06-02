import {
  detectOpenArmHfMp4Codec,
  findOpenArmHfMp4BoxOffset,
  findOpenArmHfMp4BoxPayload,
  stripOpenArmHfTimestampPrefix,
} from "@/features/teleop/perception/openArmHfLiveMse";
import {
  OPENARM_HF_LIVE_AV1_MAX_LEB128_BYTES,
  OPENARM_HF_LIVE_AV1_OBU_EXTENSION_FLAG_SHIFT,
  OPENARM_HF_LIVE_AV1_OBU_HAS_SIZE_FIELD_SHIFT,
  OPENARM_HF_LIVE_AV1_OBU_SIZE_CHUNK_BITS,
  OPENARM_HF_LIVE_AV1_OBU_SIZE_CONTINUATION_MASK,
  OPENARM_HF_LIVE_AV1_OBU_SIZE_VALUE_MASK,
  OPENARM_HF_LIVE_AV1_OBU_TYPE_MASK,
  OPENARM_HF_LIVE_AV1_OBU_TYPE_SHIFT,
  OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MAX_OBU_TYPE,
  OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MIN_OBU_TYPE,
  OPENARM_HF_LIVE_AV1_TEMPORAL_DELIMITER_OBU_TYPE,
  OPENARM_HF_LIVE_DEPTH_8BIT_TO_10BIT_OFFSET,
  OPENARM_HF_LIVE_DEPTH_8BIT_TO_10BIT_SCALE,
  OPENARM_HF_LIVE_DEPTH_10BIT_MAX,
  OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_8BIT_BT709_DIVISOR,
  OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_8BIT_BT709_OFFSET,
  OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_GREEN_CHANNEL_OFFSET,
  OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_RGBA_COMPONENTS,
} from "@/features/teleop/perception/openArmHfLiveParams";

type VideoDecoderConstructor = typeof VideoDecoder;

const MP4_DEPTH_BOX_TYPES = {
  av1C: "av1C",
  mdat: "mdat",
  moof: "moof",
} as const;

const readLeb128 = (data: Uint8Array, offset: number): [number, number] => {
  let value = 0;
  let byteCount = 0;
  for (
    let index = 0;
    index < OPENARM_HF_LIVE_AV1_MAX_LEB128_BYTES && offset + index < data.length;
    index += 1
  ) {
    const byte = data[offset + index];
    value |=
      (byte & OPENARM_HF_LIVE_AV1_OBU_SIZE_VALUE_MASK) <<
      (index * OPENARM_HF_LIVE_AV1_OBU_SIZE_CHUNK_BITS);
    byteCount += 1;
    if ((byte & OPENARM_HF_LIVE_AV1_OBU_SIZE_CONTINUATION_MASK) === 0) break;
  }
  return [value, byteCount];
};

const readAv1ObuType = (header: number): number =>
  (header >> OPENARM_HF_LIVE_AV1_OBU_TYPE_SHIFT) & OPENARM_HF_LIVE_AV1_OBU_TYPE_MASK;

const collectAv1Obus = (
  data: Uint8Array,
  shouldKeep: (obuType: number) => boolean
): Uint8Array => {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const header = data[offset];
    const obuType = readAv1ObuType(header);
    const hasExtension = (header >> OPENARM_HF_LIVE_AV1_OBU_EXTENSION_FLAG_SHIFT) & 1;
    const hasSizeField = (header >> OPENARM_HF_LIVE_AV1_OBU_HAS_SIZE_FIELD_SHIFT) & 1;
    let headerSize = 1 + hasExtension;
    if (!hasSizeField) {
      if (shouldKeep(obuType)) chunks.push(data.subarray(offset));
      break;
    }
    const [payloadSize, sizeBytes] = readLeb128(data, offset + headerSize);
    headerSize += sizeBytes;
    const obuSize = headerSize + payloadSize;
    const endOffset = Math.min(offset + obuSize, data.length);
    if (shouldKeep(obuType)) chunks.push(data.subarray(offset, endOffset));
    offset = endOffset;
  }

  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let writeOffset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  });
  return result;
};

const stripTemporalDelimiterObus = (data: Uint8Array): Uint8Array =>
  collectAv1Obus(data, (obuType) => obuType !== OPENARM_HF_LIVE_AV1_TEMPORAL_DELIMITER_OBU_TYPE);

const collectSequenceHeaderObus = (data: Uint8Array): Uint8Array =>
  collectAv1Obus(
    data,
    (obuType) =>
      obuType >= OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MIN_OBU_TYPE &&
      obuType <= OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MAX_OBU_TYPE
  );

const containsSequenceHeaderObu = (data: Uint8Array): boolean => {
  let offset = 0;
  while (offset < data.length) {
    const header = data[offset];
    const obuType = readAv1ObuType(header);
    if (
      obuType >= OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MIN_OBU_TYPE &&
      obuType <= OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MAX_OBU_TYPE
    ) {
      return true;
    }
    const hasExtension = (header >> OPENARM_HF_LIVE_AV1_OBU_EXTENSION_FLAG_SHIFT) & 1;
    const hasSizeField = (header >> OPENARM_HF_LIVE_AV1_OBU_HAS_SIZE_FIELD_SHIFT) & 1;
    let headerSize = 1 + hasExtension;
    if (!hasSizeField) break;
    const [payloadSize, sizeBytes] = readLeb128(data, offset + headerSize);
    headerSize += sizeBytes;
    offset += headerSize + payloadSize;
  }
  return false;
};

const isRgbLikeVideoFrame = (format: string): boolean =>
  format.includes("RGB") || format.includes("BGR");

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

export class OpenArmHfLiveDepthDecoder {
  latestY: Uint8Array | Uint16Array | null = null;
  width = 0;
  height = 0;
  is10bit = false;

  private decoder: VideoDecoder | null = null;
  private codec: string | null = null;
  private av1cDescription: ArrayBuffer | null = null;
  private sequenceHeader: Uint8Array | null = null;
  private frameCount = 0;

  get available(): boolean {
    return Boolean(this.latestY && this.width > 0 && this.height > 0);
  }

  onData(data: Uint8Array): void {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") return;
    const segment = stripOpenArmHfTimestampPrefix(data);
    const codec = detectOpenArmHfMp4Codec(segment);
    if (codec) {
      this.codec = codec;
      const av1c = findOpenArmHfMp4BoxPayload(segment, MP4_DEPTH_BOX_TYPES.av1C);
      if (av1c) {
        this.av1cDescription = toArrayBuffer(av1c);
        this.sequenceHeader = av1c.length > 4 ? av1c.subarray(4) : null;
      }
    }

    const mediaOffset = findOpenArmHfMp4BoxOffset(segment, MP4_DEPTH_BOX_TYPES.moof);
    const mediaSegment = mediaOffset >= 0 ? segment.subarray(mediaOffset) : segment;
    const mdat = findOpenArmHfMp4BoxPayload(mediaSegment, MP4_DEPTH_BOX_TYPES.mdat);
    if (!mdat || !mdat.length || !this.codec) return;
    this.ensureDecoder();
    if (!this.decoder || this.decoder.state !== "configured") return;

    const frameOnly = stripTemporalDelimiterObus(mdat);
    const sequenceHeader = this.sequenceHeader ?? collectSequenceHeaderObus(frameOnly);
    const chunkData =
      sequenceHeader && sequenceHeader.length > 0 && !containsSequenceHeaderObu(frameOnly)
        ? (() => {
            const combined = new Uint8Array(sequenceHeader.length + frameOnly.length);
            combined.set(sequenceHeader);
            combined.set(frameOnly, sequenceHeader.length);
            return combined;
          })()
        : frameOnly;

    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: containsSequenceHeaderObu(mdat) ? "key" : "delta",
          timestamp: this.frameCount,
          data: chunkData,
        })
      );
      this.frameCount += 1;
    } catch {
      this.resetDecoder();
    }
  }

  destroy(): void {
    this.resetDecoder();
    this.latestY = null;
  }

  private ensureDecoder(): void {
    if (this.decoder || !this.codec) return;
    const decoderCtor = VideoDecoder as VideoDecoderConstructor;
    this.decoder = new decoderCtor({
      output: (frame) => {
        void this.processFrame(frame);
      },
      error: () => this.resetDecoder(),
    });
    const config: VideoDecoderConfig = {
      codec: this.codec,
      hardwareAcceleration: "prefer-software",
    };
    if (this.av1cDescription) config.description = this.av1cDescription;
    try {
      this.decoder.configure(config);
    } catch {
      this.resetDecoder();
    }
  }

  private resetDecoder(): void {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        // Decoder close can race with browser teardown.
      }
    }
    this.decoder = null;
  }

  private async processFrame(frame: VideoFrame): Promise<void> {
    try {
      const width = frame.displayWidth;
      const height = frame.displayHeight;
      const pixelCount = width * height;
      const allocationSize = frame.allocationSize();
      const buffer = new ArrayBuffer(allocationSize);
      const layouts = await frame.copyTo(buffer);
      const format = frame.format ?? "";
      const firstPlane = layouts[0];

      if (isRgbLikeVideoFrame(format)) {
        this.copyRgbLikeDepth(buffer, firstPlane, width, height, pixelCount);
      } else if (format.includes("10") || format.includes("12")) {
        this.copyPlanar10BitDepth(buffer, firstPlane, width, height, pixelCount);
      } else if (this.codec?.endsWith(".10")) {
        this.copyUpscaledPlanar8BitDepth(buffer, firstPlane, width, height, pixelCount);
      } else {
        this.copyPlanar8BitDepth(buffer, firstPlane, width, height, pixelCount);
      }
      this.width = width;
      this.height = height;
    } finally {
      frame.close();
    }
  }

  private copyRgbLikeDepth(
    buffer: ArrayBuffer,
    plane: PlaneLayout,
    width: number,
    height: number,
    pixelCount: number
  ): void {
    const source = new Uint8Array(buffer);
    if (this.codec?.endsWith(".10")) {
      if (!(this.latestY instanceof Uint16Array) || this.latestY.length !== pixelCount) {
        this.latestY = new Uint16Array(pixelCount);
      }
      for (let row = 0; row < height; row += 1) {
        const rowOffset = plane.offset + row * plane.stride;
        for (let column = 0; column < width; column += 1) {
          const sample =
            source[
              rowOffset +
                column * OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_RGBA_COMPONENTS +
                OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_GREEN_CHANNEL_OFFSET
            ];
          this.latestY[row * width + column] =
            sample < 2
              ? 0
              : Math.min(
                  OPENARM_HF_LIVE_DEPTH_10BIT_MAX,
                  Math.round(
                    sample * OPENARM_HF_LIVE_DEPTH_8BIT_TO_10BIT_SCALE +
                      OPENARM_HF_LIVE_DEPTH_8BIT_TO_10BIT_OFFSET
                  )
                );
        }
      }
      this.is10bit = true;
      return;
    }

    if (!(this.latestY instanceof Uint8Array) || this.latestY.length !== pixelCount) {
      this.latestY = new Uint8Array(pixelCount);
    }
    for (let row = 0; row < height; row += 1) {
      const rowOffset = plane.offset + row * plane.stride;
      for (let column = 0; column < width; column += 1) {
        const sample =
          source[
            rowOffset +
              column * OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_RGBA_COMPONENTS +
              OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_GREEN_CHANNEL_OFFSET
          ];
        this.latestY[row * width + column] = Math.min(
          255,
          Math.round(
            sample / OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_8BIT_BT709_DIVISOR +
              OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_8BIT_BT709_OFFSET
          )
        );
      }
    }
    this.is10bit = false;
  }

  private copyPlanar10BitDepth(
    buffer: ArrayBuffer,
    plane: PlaneLayout,
    width: number,
    height: number,
    pixelCount: number
  ): void {
    if (!(this.latestY instanceof Uint16Array) || this.latestY.length !== pixelCount) {
      this.latestY = new Uint16Array(pixelCount);
    }
    const source = new Uint16Array(buffer);
    const rowStride = plane.stride / Uint16Array.BYTES_PER_ELEMENT;
    const sourceOffset = plane.offset / Uint16Array.BYTES_PER_ELEMENT;
    for (let row = 0; row < height; row += 1) {
      this.latestY.set(
        source.subarray(sourceOffset + row * rowStride, sourceOffset + row * rowStride + width),
        row * width
      );
    }
    this.is10bit = true;
  }

  private copyUpscaledPlanar8BitDepth(
    buffer: ArrayBuffer,
    plane: PlaneLayout,
    width: number,
    height: number,
    pixelCount: number
  ): void {
    if (!(this.latestY instanceof Uint16Array) || this.latestY.length !== pixelCount) {
      this.latestY = new Uint16Array(pixelCount);
    }
    const source = new Uint8Array(buffer);
    for (let row = 0; row < height; row += 1) {
      const rowOffset = plane.offset + row * plane.stride;
      for (let column = 0; column < width; column += 1) {
        this.latestY[row * width + column] = source[rowOffset + column] << 2;
      }
    }
    this.is10bit = true;
  }

  private copyPlanar8BitDepth(
    buffer: ArrayBuffer,
    plane: PlaneLayout,
    width: number,
    height: number,
    pixelCount: number
  ): void {
    if (!(this.latestY instanceof Uint8Array) || this.latestY.length !== pixelCount) {
      this.latestY = new Uint8Array(pixelCount);
    }
    const source = new Uint8Array(buffer);
    for (let row = 0; row < height; row += 1) {
      this.latestY.set(
        source.subarray(plane.offset + row * plane.stride, plane.offset + row * plane.stride + width),
        row * width
      );
    }
    this.is10bit = false;
  }
}
