import { renameLinkInUrdf } from "@/shared/lib/urdfCore";

export function updateLinkNameInURDF(
  urdfContent: string,
  oldLinkName: string,
  newLinkName: string
): string {
  const result = renameLinkInUrdf(urdfContent, oldLinkName, newLinkName);
  return result.success ? result.content : urdfContent;
}
