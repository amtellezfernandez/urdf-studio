export type SerializedBlobPayload = {
  base64Content: string;
  mimeType: string | null;
};

type BlobToBase64Options = {
  readErrorMessage?: string;
  encodeErrorMessage?: string;
};

const BLOB_BASE64_ENCODING_PARAMS = {
  chunkSizeBytes: 0x8000,
  readErrorMessage: "Failed to read blob for base64 encoding.",
  encodeErrorMessage: "Failed to encode blob as base64.",
};

const errorWithCause = (message: string, cause: unknown): Error => {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (
    let index = 0;
    index < bytes.length;
    index += BLOB_BASE64_ENCODING_PARAMS.chunkSizeBytes
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + BLOB_BASE64_ENCODING_PARAMS.chunkSizeBytes)
    );
  }
  return btoa(binary);
};

export const blobToBase64 = async (
  blob: Blob,
  options: BlobToBase64Options = {}
): Promise<string> => {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    throw errorWithCause(
      options.readErrorMessage ?? BLOB_BASE64_ENCODING_PARAMS.readErrorMessage,
      error
    );
  }

  try {
    return bytesToBase64(bytes);
  } catch (error) {
    throw errorWithCause(
      options.encodeErrorMessage ?? BLOB_BASE64_ENCODING_PARAMS.encodeErrorMessage,
      error
    );
  }
};

export const serializeBlobPayload = async (
  blob: Blob,
  options: BlobToBase64Options = {}
): Promise<SerializedBlobPayload> => ({
  base64Content: await blobToBase64(blob, options),
  mimeType: blob.type || null,
});

export const base64ToBlob = ({
  base64Content,
  mimeType,
}: SerializedBlobPayload): Blob => {
  const binary = atob(base64Content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType ?? "" });
};
