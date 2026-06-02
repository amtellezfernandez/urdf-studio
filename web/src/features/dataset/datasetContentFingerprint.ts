import { DATASET_CONTENT_FINGERPRINT_PARAMS } from "@/features/dataset/datasetContentFingerprintParams";
import {
  buildEpisodeCollectionContentSignature,
  type DatasetContentSignatureFrame,
} from "@/features/dataset/datasetTreatmentSignatures";

const HASH_OFFSET_BASIS =
  DATASET_CONTENT_FINGERPRINT_PARAMS.hashOffsetBasis;
const HASH_PRIME = DATASET_CONTENT_FINGERPRINT_PARAMS.hashPrime;
const HASH_MASK = DATASET_CONTENT_FINGERPRINT_PARAMS.hashMask;
const FLOAT_PRECISION_DIGITS =
  DATASET_CONTENT_FINGERPRINT_PARAMS.floatPrecisionDigits;

const updateHash = (hash: bigint, value: string) => {
  let nextHash = hash;
  for (const byte of new TextEncoder().encode(value)) {
    nextHash ^= BigInt(byte);
    nextHash = (nextHash * HASH_PRIME) & HASH_MASK;
  }
  return nextHash;
};

const normalizeNumber = (value: number) =>
  Number.isFinite(value)
    ? value.toFixed(FLOAT_PRECISION_DIGITS)
    : DATASET_CONTENT_FINGERPRINT_PARAMS.finiteNumberFallback;

const hashEpisodeFrames = (
  hash: bigint,
  frames: DatasetContentSignatureFrame[]
) => {
  let nextHash = updateHash(hash, `frames:${frames.length}`);
  frames.forEach((frame, frameIndex) => {
    nextHash = updateHash(nextHash, `t:${frameIndex}:${normalizeNumber(frame.timestamp)}`);
    const jointNames = Object.keys(frame.joints).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
    );
    jointNames.forEach((jointName) => {
      nextHash = updateHash(
        nextHash,
        `j:${jointName}:${normalizeNumber(frame.joints[jointName] ?? 0)}`
      );
    });
  });
  return nextHash;
};

export const computeEpisodeCollectionFingerprint = (
  episodes: Parameters<typeof buildEpisodeCollectionContentSignature>[0]
) => {
  const signature = buildEpisodeCollectionContentSignature(episodes);
  const sortedEpisodes = signature.episodes;

  let hash = updateHash(HASH_OFFSET_BASIS, `episodes:${sortedEpisodes.length}`);
  sortedEpisodes.forEach((episode, episodeIndex) => {
    hash = updateHash(hash, `episode:${episodeIndex}`);
    hash = hashEpisodeFrames(hash, episode.frames);
  });
  return hash
    .toString(DATASET_CONTENT_FINGERPRINT_PARAMS.outputRadix)
    .padStart(
      DATASET_CONTENT_FINGERPRINT_PARAMS.outputLength,
      DATASET_CONTENT_FINGERPRINT_PARAMS.padCharacter
    );
};
