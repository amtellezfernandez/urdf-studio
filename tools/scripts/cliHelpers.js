import { resolve } from 'path';
import { pathToFileURL } from 'url';

export function readOptionValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function isMainModule(importMetaUrl) {
  return Boolean(process.argv[1] && importMetaUrl === pathToFileURL(resolve(process.argv[1])).href);
}

export function readUnknownErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runCliMain(importMetaUrl, main) {
  if (!isMainModule(importMetaUrl)) {
    return;
  }
  try {
    main();
  } catch (error) {
    console.error(readUnknownErrorMessage(error));
    process.exitCode = 1;
  }
}
