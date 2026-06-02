import { parseUrdfDocument, serializeUrdfDocument } from "@/shared/lib/urdfCore";
import {
  buildUrdfOriginAttributes,
  createFullUrdfOriginBake,
  IDENTITY_URDF_ORIGIN,
  type ResolvedUrdfOriginBake,
  type UrdfOriginPose,
} from "./transformMath";

export type UrdfBakeEntryKind = "visual" | "collision";
export type UrdfBakeSkipReason = "identity-origin" | "missing-link";

export type UrdfBakePreviewEntry = {
  kind: UrdfBakeEntryKind;
  linkName: string;
  index: number;
  geometryType: string | null;
  meshFilename: string | null;
  bake: ResolvedUrdfOriginBake;
};

export type UrdfBakePreviewSkip = {
  kind: UrdfBakeEntryKind;
  linkName: string;
  index: number;
  reason: UrdfBakeSkipReason;
};

export type UrdfBakePreviewScope = {
  kinds?: UrdfBakeEntryKind[];
  linkNames?: string[];
};

export type UrdfBakePreviewResult =
  | {
      success: true;
      content: string;
      entries: UrdfBakePreviewEntry[];
      skipped: UrdfBakePreviewSkip[];
    }
  | {
      success: false;
      content: string;
      error: string;
      entries: [];
      skipped: UrdfBakePreviewSkip[];
    };

export type UrdfBakePreviewSuccess = Extract<UrdfBakePreviewResult, { success: true }>;

export type UrdfBakePreviewSession = {
  sourceContent: string;
  stagedContent: string;
  preview: UrdfBakePreviewSuccess;
};

export type UrdfBakePreviewStats = {
  entryCount: number;
  meshBackedEntryCount: number;
  linkNames: string[];
};

export type UrdfBakedMeshPlanEntry = {
  meshReference: string;
  bakeMatrixElements: number[];
  linkNames: string[];
  sourceEntryCount: number;
};

export type UrdfBakedMeshPlanConflict = {
  meshReference: string;
  linkNames: string[];
};

export type UrdfBakedMeshPlan = {
  entries: UrdfBakedMeshPlanEntry[];
  conflicts: UrdfBakedMeshPlanConflict[];
};

const DEFAULT_BAKE_KINDS: UrdfBakeEntryKind[] = ["visual", "collision"];

const parseOriginTriplet = (value: string | null): [number, number, number] => {
  if (!value) {
    return [0, 0, 0];
  }

  const tokens = value
    .trim()
    .split(/\s+/)
    .map((token) => Number.parseFloat(token));

  return [
    Number.isFinite(tokens[0]) ? tokens[0] : 0,
    Number.isFinite(tokens[1]) ? tokens[1] : 0,
    Number.isFinite(tokens[2]) ? tokens[2] : 0,
  ];
};

const readOriginPose = (element: Element): UrdfOriginPose => {
  const originElement = element.querySelector(":scope > origin");
  return {
    xyz: parseOriginTriplet(originElement?.getAttribute("xyz") ?? null),
    rpy: parseOriginTriplet(originElement?.getAttribute("rpy") ?? null),
  };
};

const isIdentityOrigin = (origin: UrdfOriginPose): boolean =>
  origin.xyz.every((value) => value === 0) && origin.rpy.every((value) => value === 0);

const getGeometryType = (element: Element): string | null => {
  const geometryElement = element.querySelector(":scope > geometry");
  if (!geometryElement) {
    return null;
  }
  return geometryElement.firstElementChild?.tagName ?? null;
};

const getMeshFilename = (element: Element): string | null =>
  element.querySelector(":scope > geometry > mesh")?.getAttribute("filename") ?? null;

const ensureOriginElement = (xmlDoc: XMLDocument, element: Element): Element => {
  const existingOrigin = element.querySelector(":scope > origin");
  if (existingOrigin) {
    return existingOrigin;
  }
  const originElement = xmlDoc.createElement("origin");
  element.insertBefore(originElement, element.firstChild);
  return originElement;
};

const normalizeKinds = (scope: UrdfBakePreviewScope): Set<UrdfBakeEntryKind> =>
  new Set(scope.kinds && scope.kinds.length > 0 ? scope.kinds : DEFAULT_BAKE_KINDS);

const normalizeLinkNames = (scope: UrdfBakePreviewScope): Set<string> | null =>
  scope.linkNames && scope.linkNames.length > 0 ? new Set(scope.linkNames) : null;

const listEntries = (linkElement: Element, kind: UrdfBakeEntryKind): Element[] =>
  Array.from(linkElement.querySelectorAll(`:scope > ${kind}`));

export const buildVirtualBakePreview = (
  urdfContent: string,
  scope: UrdfBakePreviewScope = {}
): UrdfBakePreviewResult => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  if (!xmlDoc) {
    return {
      success: false,
      content: urdfContent,
      error: "Failed to parse URDF for bake preview.",
      entries: [],
      skipped: [],
    };
  }

  const robotElement = xmlDoc.querySelector("robot");
  if (!robotElement) {
    return {
      success: false,
      content: urdfContent,
      error: "URDF is missing a robot root element.",
      entries: [],
      skipped: [],
    };
  }

  const kinds = normalizeKinds(scope);
  const requestedLinkNames = normalizeLinkNames(scope);
  const availableLinkNames = new Set(
    Array.from(robotElement.querySelectorAll(":scope > link[name]")).map(
      (linkElement) => linkElement.getAttribute("name") ?? ""
    )
  );
  const skipped: UrdfBakePreviewSkip[] = [];

  if (requestedLinkNames) {
    requestedLinkNames.forEach((linkName) => {
      if (!availableLinkNames.has(linkName)) {
        skipped.push({
          kind: "visual",
          linkName,
          index: -1,
          reason: "missing-link",
        });
      }
    });
  }

  const entries: UrdfBakePreviewEntry[] = [];
  const linkElements = Array.from(robotElement.querySelectorAll(":scope > link[name]")).filter(
    (linkElement) => {
      const linkName = linkElement.getAttribute("name");
      return Boolean(linkName && (!requestedLinkNames || requestedLinkNames.has(linkName)));
    }
  );

  linkElements.forEach((linkElement) => {
    const linkName = linkElement.getAttribute("name");
    if (!linkName) {
      return;
    }

    kinds.forEach((kind) => {
      listEntries(linkElement, kind).forEach((entryElement, index) => {
        const origin = readOriginPose(entryElement);
        if (isIdentityOrigin(origin)) {
          skipped.push({
            kind,
            linkName,
            index,
            reason: "identity-origin",
          });
          return;
        }

        const bake = createFullUrdfOriginBake(origin);
        const originElement = ensureOriginElement(xmlDoc, entryElement);
        const bakedOriginAttributes = buildUrdfOriginAttributes(IDENTITY_URDF_ORIGIN);
        originElement.setAttribute("xyz", bakedOriginAttributes.xyz);
        originElement.setAttribute("rpy", bakedOriginAttributes.rpy);

        entries.push({
          kind,
          linkName,
          index,
          geometryType: getGeometryType(entryElement),
          meshFilename: getMeshFilename(entryElement),
          bake,
        });
      });
    });
  });

  return {
    success: true,
    content: serializeUrdfDocument(xmlDoc),
    entries,
    skipped,
  };
};

export const buildUrdfBakePreviewStats = (
  preview: UrdfBakePreviewSuccess | UrdfBakePreviewSession
): UrdfBakePreviewStats => {
  const entries = "preview" in preview ? preview.preview.entries : preview.entries;
  return {
    entryCount: entries.length,
    meshBackedEntryCount: entries.filter((entry) => Boolean(entry.meshFilename)).length,
    linkNames: Array.from(new Set(entries.map((entry) => entry.linkName))).sort((lhs, rhs) =>
      lhs.localeCompare(rhs)
    ),
  };
};

const serializeBakeMatrixElements = (elements: number[]): string =>
  elements.map((value) => Number(value.toFixed(9))).join(",");

export const buildUrdfBakedMeshPlan = (
  preview: UrdfBakePreviewSuccess | UrdfBakePreviewSession
): UrdfBakedMeshPlan => {
  const entries = "preview" in preview ? preview.preview.entries : preview.entries;
  const meshEntries = entries.filter(
    (entry): entry is UrdfBakePreviewEntry & { meshFilename: string } => Boolean(entry.meshFilename)
  );
  const uniquePlans = new Map<string, UrdfBakedMeshPlanEntry>();
  const meshReferenceToSignatures = new Map<string, Set<string>>();
  const meshReferenceToLinks = new Map<string, Set<string>>();

  meshEntries.forEach((entry) => {
    const bakeMatrixElements = Array.from(entry.bake.bakeMatrix.elements).map((value) =>
      Number(value.toFixed(9))
    );
    const signature = serializeBakeMatrixElements(bakeMatrixElements);
    const meshReference = entry.meshFilename;
    const planKey = `${meshReference}::${signature}`;
    const existing = uniquePlans.get(planKey);
    if (existing) {
      existing.sourceEntryCount += 1;
      if (!existing.linkNames.includes(entry.linkName)) {
        existing.linkNames.push(entry.linkName);
        existing.linkNames.sort((lhs, rhs) => lhs.localeCompare(rhs));
      }
    } else {
      uniquePlans.set(planKey, {
        meshReference,
        bakeMatrixElements,
        linkNames: [entry.linkName],
        sourceEntryCount: 1,
      });
    }

    const signatures = meshReferenceToSignatures.get(meshReference) ?? new Set<string>();
    signatures.add(signature);
    meshReferenceToSignatures.set(meshReference, signatures);

    const linkNames = meshReferenceToLinks.get(meshReference) ?? new Set<string>();
    linkNames.add(entry.linkName);
    meshReferenceToLinks.set(meshReference, linkNames);
  });

  const conflicts: UrdfBakedMeshPlanConflict[] = [];
  meshReferenceToSignatures.forEach((signatures, meshReference) => {
    if (signatures.size <= 1) {
      return;
    }
    conflicts.push({
      meshReference,
      linkNames: Array.from(meshReferenceToLinks.get(meshReference) ?? []).sort((lhs, rhs) =>
        lhs.localeCompare(rhs)
      ),
    });
  });

  return {
    entries: Array.from(uniquePlans.values()).sort((lhs, rhs) =>
      lhs.meshReference.localeCompare(rhs.meshReference)
    ),
    conflicts: conflicts.sort((lhs, rhs) => lhs.meshReference.localeCompare(rhs.meshReference)),
  };
};
