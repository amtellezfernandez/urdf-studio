import {
  KITCHEN_DEFAULT_ROBOT_NAME,
  KITCHEN_DESCRIPTION_SUFFIX,
  KITCHEN_GENERATED_URDF_EXTENSION,
  KITCHEN_MESHES_DIRECTORY,
  KITCHEN_PART_ROOT_TAG,
  KITCHEN_PROJECT_ROOT_TAG,
  KITCHEN_SINGULAR_PART_COUNT,
  KITCHEN_URDF_DIRECTORY,
  KITCHEN_XML_EXTENSION,
} from "@/features/kitchen/kitchenParams";
import {
  buildKitchenUrdfFromPartCatalog,
  buildKitchenUrdfFromProject,
  parseKitchenPartRecipeXml,
  parseKitchenProjectXml,
  type KitchenPartRecipe,
  type KitchenUrdfBuildResult,
} from "@/features/kitchen/kitchenProject";

export type KitchenTextFile = {
  path: string;
  text: string;
};

export type KitchenGeneratedArtifact = KitchenUrdfBuildResult & {
  kind: "project" | "part_catalog";
  sourcePath: string | null;
  generatedUrdfPath: string;
  partCount: number;
};

const normalizePath = (path: string): string => path.replace(/\\/g, "/").replace(/^\/+/, "");

const basename = (path: string): string => normalizePath(path).split("/").filter(Boolean).pop() || "";

const dirname = (path: string): string => {
  const parts = normalizePath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, "");

const stripDescriptionSuffix = (value: string): string =>
  value.endsWith(KITCHEN_DESCRIPTION_SUFFIX)
    ? value.slice(0, -KITCHEN_DESCRIPTION_SUFFIX.length)
    : value;

const sanitizeToken = (value: string): string =>
  value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || KITCHEN_DEFAULT_ROBOT_NAME;

const getXmlRootTagName = (xml: string): string | null => {
  const match = xml.trim().match(/^<\?xml[^>]*>\s*<([A-Za-z0-9_:-]+)/) ?? xml.trim().match(/^<([A-Za-z0-9_:-]+)/);
  return match?.[1] ?? null;
};

const findDescriptionRootForPath = (path: string): string => {
  const normalized = normalizePath(path);
  const meshSegment = `/${KITCHEN_MESHES_DIRECTORY}/`;
  const meshIndex = normalized.toLowerCase().lastIndexOf(meshSegment);
  if (meshIndex >= 0) {
    return normalized.slice(0, meshIndex);
  }
  return dirname(normalized);
};

const commonDirectory = (paths: string[]): string => {
  const pathParts = paths.map((path) => dirname(path).split("/").filter(Boolean));
  const [firstParts] = pathParts;
  if (!firstParts) return "";
  const common = [...firstParts];
  for (const parts of pathParts.slice(1)) {
    while (common.length > 0 && common.some((part, index) => parts[index] !== part)) {
      common.pop();
    }
  }
  return common.join("/");
};

const buildGeneratedPath = (descriptionRoot: string, robotName: string): string =>
  [descriptionRoot, KITCHEN_URDF_DIRECTORY, `${sanitizeToken(robotName)}${KITCHEN_GENERATED_URDF_EXTENSION}`]
    .filter(Boolean)
    .join("/");

const resolveRobotNameHint = (files: KitchenTextFile[]): string => {
  const descriptionRoot = files
    .map((file) => findDescriptionRootForPath(file.path))
    .find(Boolean);
  const rootName = basename(descriptionRoot || commonDirectory(files.map((file) => file.path)));
  return sanitizeToken(stripDescriptionSuffix(rootName || KITCHEN_DEFAULT_ROBOT_NAME));
};

const resolvePackageName = (descriptionRoot: string, robotName: string): string =>
  sanitizeToken(basename(descriptionRoot) || `${robotName}${KITCHEN_DESCRIPTION_SUFFIX}`);

const buildProjectArtifact = (file: KitchenTextFile): KitchenGeneratedArtifact => {
  const project = parseKitchenProjectXml(file.text);
  const descriptionRoot = findDescriptionRootForPath(file.path);
  const result = buildKitchenUrdfFromProject({
    ...project,
    packageName: resolvePackageName(descriptionRoot, project.robotName),
  });
  return {
    ...result,
    kind: "project",
    sourcePath: normalizePath(file.path),
    generatedUrdfPath: buildGeneratedPath(descriptionRoot, result.robotName),
    partCount: project.nodes.filter((node) => node.stlFile).length,
  };
};

const parsePartRecipes = (files: KitchenTextFile[]): KitchenPartRecipe[] =>
  files
    .filter((file) => getXmlRootTagName(file.text) === KITCHEN_PART_ROOT_TAG)
    .map((file) => parseKitchenPartRecipeXml(file.text, normalizePath(file.path)));

const buildPartCatalogArtifact = (
  files: KitchenTextFile[],
  parts: KitchenPartRecipe[]
): KitchenGeneratedArtifact | null => {
  if (parts.length === 0) return null;
  const robotNameHint = resolveRobotNameHint(files);
  const descriptionRoot =
    parts.map((part) => findDescriptionRootForPath(part.sourcePath)).find(Boolean) ||
    commonDirectory(files.map((file) => file.path));
  const result = buildKitchenUrdfFromPartCatalog(robotNameHint, parts, {
    packageName: resolvePackageName(descriptionRoot, robotNameHint),
  });
  return {
    ...result,
    kind: "part_catalog",
    sourcePath: null,
    generatedUrdfPath: buildGeneratedPath(descriptionRoot, result.robotName),
    partCount: parts.length,
  };
};

export const buildKitchenArtifactFromXmlFiles = (
  files: KitchenTextFile[]
): KitchenGeneratedArtifact | null => {
  const xmlFiles = files
    .map((file) => ({ path: normalizePath(file.path), text: file.text }))
    .filter((file) => file.path.toLowerCase().endsWith(KITCHEN_XML_EXTENSION));
  if (xmlFiles.length === 0) return null;

  const projectFile = xmlFiles.find(
    (file) => getXmlRootTagName(file.text) === KITCHEN_PROJECT_ROOT_TAG
  );
  if (projectFile) {
    return buildProjectArtifact(projectFile);
  }

  return buildPartCatalogArtifact(xmlFiles, parsePartRecipes(xmlFiles));
};

export const describeKitchenArtifact = (artifact: KitchenGeneratedArtifact): string => {
  const sourceLabel =
    artifact.kind === "project" && artifact.sourcePath
      ? stripExtension(basename(artifact.sourcePath))
      : "part catalog";
  return `${artifact.robotName} Kitchen ${sourceLabel} (${artifact.partCount} part${
    artifact.partCount === KITCHEN_SINGULAR_PART_COUNT ? "" : "s"
  })`;
};
