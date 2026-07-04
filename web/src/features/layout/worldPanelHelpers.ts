import type { CreatedObject } from "@/features/objects";

export type WorldObjectGroup = {
  source: string;
  label: string;
  objects: CreatedObject[];
};

export const toReadableWorldSourceLabel = (source: string): string =>
  source
    .split(/[-_]/g)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

export const toWorldObjectDisplayName = (worldObject: CreatedObject): string => {
  const generatedObjectIdPrefix = "object-";
  const objectOrdinal = worldObject.id.startsWith(generatedObjectIdPrefix)
    ? worldObject.id.slice(generatedObjectIdPrefix.length)
    : worldObject.id;
  const objectTypeLabel =
    worldObject.type.charAt(0).toUpperCase() + worldObject.type.slice(1);
  return `${objectTypeLabel} ${objectOrdinal}`;
};

export const buildWorldObjectGroups = ({
  objects,
  sourceOrder,
  sourceLabels,
}: {
  objects: CreatedObject[];
  sourceOrder: readonly NonNullable<CreatedObject["source"]>[];
  sourceLabels: Record<NonNullable<CreatedObject["source"]>, string>;
}): WorldObjectGroup[] => {
  const groupedBySource = new Map<string, CreatedObject[]>();
  objects.forEach((object) => {
    const source = object.source ?? "user";
    const existingSourceObjects = groupedBySource.get(source);
    if (existingSourceObjects) {
      existingSourceObjects.push(object);
    } else {
      groupedBySource.set(source, [object]);
    }
  });

  const sourceIndexByName = new Map(sourceOrder.map((source, index) => [source, index]));

  return [...groupedBySource.entries()]
    .sort(([leftSource], [rightSource]) => {
      const leftSourceIndex = sourceIndexByName.get(
        leftSource as NonNullable<CreatedObject["source"]>
      );
      const rightSourceIndex = sourceIndexByName.get(
        rightSource as NonNullable<CreatedObject["source"]>
      );
      return (leftSourceIndex ?? Number.MAX_SAFE_INTEGER) - (rightSourceIndex ?? Number.MAX_SAFE_INTEGER);
    })
    .map(([source, sourceObjects]) => ({
      source,
      label:
        sourceLabels[source as NonNullable<CreatedObject["source"]>] ??
        `${toReadableWorldSourceLabel(source)} Objects`,
      objects: [...sourceObjects].sort((leftObject, rightObject) =>
        leftObject.id.localeCompare(rightObject.id)
      ),
    }));
};
