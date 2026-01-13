import type { ComponentProps } from "react";
import { MappingPanels } from "@/pages/index/MappingPanels";
import { CreationDialogs } from "@/pages/index/CreationDialogs";

type PageDialogsProps = {
  mappingPanelsProps: ComponentProps<typeof MappingPanels>;
  creationDialogsProps: ComponentProps<typeof CreationDialogs>;
};

export const PageDialogs = ({ mappingPanelsProps, creationDialogsProps }: PageDialogsProps) => (
  <>
    <MappingPanels {...mappingPanelsProps} />
    <CreationDialogs {...creationDialogsProps} />
  </>
);
