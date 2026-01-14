/**
 * Finds the deepest leaf link in a URDF document. Used as a heuristic
 * to auto-select an end-effector when the user has not yet specified one.
 */
export const findDeepestLeafLink = (urdfContent: string): string | null => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    if (xmlDoc.querySelector("parsererror")) return null;

    const linkNames = Array.from(xmlDoc.querySelectorAll("link"))
      .map((el) => el.getAttribute("name"))
      .filter((name): name is string => !!name);
    if (linkNames.length === 0) return null;

    const parentToChildren = new Map<string, string[]>();
    const childLinks = new Set<string>();
    const parentLinks = new Set<string>();

    xmlDoc.querySelectorAll("joint").forEach((joint) => {
      const parentLink = joint.querySelector("parent")?.getAttribute("link");
      const childLink = joint.querySelector("child")?.getAttribute("link");
      if (parentLink && childLink) {
        parentLinks.add(parentLink);
        childLinks.add(childLink);
        const list = parentToChildren.get(parentLink) || [];
        list.push(childLink);
        parentToChildren.set(parentLink, list);
      }
    });

    const root =
      Array.from(parentLinks).find((name) => !childLinks.has(name)) ??
      linkNames.find((name) => !childLinks.has(name)) ??
      linkNames[0];

    const visited = new Set<string>();
    let best: { link: string; depth: number } | null = null;

    const dfs = (link: string, depth: number) => {
      if (visited.has(link)) return;
      visited.add(link);
      const children = parentToChildren.get(link) || [];
      if (children.length === 0) {
        if (!best || depth > best.depth) {
          best = { link, depth };
        }
      }
      children.forEach((child) => dfs(child, depth + 1));
    };

    dfs(root, 0);
    return best?.link ?? null;
  } catch {
    return null;
  }
};
