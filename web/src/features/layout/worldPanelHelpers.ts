import type { CreatedObject } from "@/features/objects";

export type WorldObjectGroup = {
  source: string;
  label: string;
  objects: CreatedObject[];
};

const WORLD_PANEL_DEFAULTS = {
  worldObjectSource: "user" as NonNullable<CreatedObject["source"]>,
} as const;

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

export const resolveWorldObjectSource = (
  worldObject: CreatedObject
): NonNullable<CreatedObject["source"]> =>
  worldObject.source ?? WORLD_PANEL_DEFAULTS.worldObjectSource;

export const resolveWorldObjectGroupLabel = ({
  source,
  sourceLabels,
}: {
  source: string;
  sourceLabels: Record<NonNullable<CreatedObject["source"]>, string>;
}): string =>
  sourceLabels[source as NonNullable<CreatedObject["source"]>] ??
  `${toReadableWorldSourceLabel(source)} Objects`;

export const buildWorldObjectSourceIndex = (
  sourceOrder: readonly NonNullable<CreatedObject["source"]>[]
): Map<NonNullable<CreatedObject["source"]>, number> =>
  new Map(sourceOrder.map((source, index) => [source, index]));

export const compareWorldObjectSources = ({
  leftSource,
  rightSource,
  sourceIndexByName,
}: {
  leftSource: string;
  rightSource: string;
  sourceIndexByName: ReadonlyMap<NonNullable<CreatedObject["source"]>, number>;
}): number => {
  const leftSourceIndex = sourceIndexByName.get(
    leftSource as NonNullable<CreatedObject["source"]>
  );
  const rightSourceIndex = sourceIndexByName.get(
    rightSource as NonNullable<CreatedObject["source"]>
  );
  return (leftSourceIndex ?? Number.MAX_SAFE_INTEGER) - (rightSourceIndex ?? Number.MAX_SAFE_INTEGER);
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
    const source = resolveWorldObjectSource(object);
    const existingSourceObjects = groupedBySource.get(source);
    if (existingSourceObjects) {
      existingSourceObjects.push(object);
    } else {
      groupedBySource.set(source, [object]);
    }
  });

  const sourceIndexByName = buildWorldObjectSourceIndex(sourceOrder);

  return [...groupedBySource.entries()]
    .sort(([leftSource], [rightSource]) =>
      compareWorldObjectSources({
        leftSource,
        rightSource,
        sourceIndexByName,
      })
    )
    .map(([source, sourceObjects]) => ({
      source,
      label: resolveWorldObjectGroupLabel({
        source,
        sourceLabels,
      }),
      objects: [...sourceObjects].sort((leftObject, rightObject) =>
        leftObject.id.localeCompare(rightObject.id)
      ),
    }));
};
