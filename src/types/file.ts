/**
 * Extended File interface to include webkitRelativePath
 * for folder selection support
 */
export interface FileWithPath extends File {
  webkitRelativePath: string;
}


