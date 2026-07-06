export type BrowserFileWithRelativePath = File & {
  webkitRelativePath?: string;
};

export const getBrowserFileRelativePath = (file: File): string => {
  const fileWithPath = file as BrowserFileWithRelativePath;
  return (fileWithPath.webkitRelativePath || file.name).replace(/\\/g, "/");
};
