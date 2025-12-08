/**
 * Parse link names from URDF content
 */
export function parseLinkNames(urdfContent: string): string[] {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

    const links = xmlDoc.querySelectorAll("link");
    const linkNames: string[] = [];

    links.forEach((link) => {
      const name = link.getAttribute("name");
      if (name) {
        linkNames.push(name);
      }
    });

    return linkNames;
  } catch (error) {
    console.error("Error parsing link names from URDF:", error);
    return [];
  }
}
