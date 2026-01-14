/**
 * URDF filename helpers.
 */

export function createVizFilename(originalFilename: string): string {
  const parts = originalFilename.split(".");
  if (parts.length > 1) {
    const ext = parts.pop();
    return `viz-${parts.join(".")}.${ext}`;
  }
  return `viz-${originalFilename}.urdf`;
}
