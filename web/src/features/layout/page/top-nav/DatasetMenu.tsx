import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { withCredentialSuffix } from "@/shared/config/credentials";
import { cn } from "@/shared/lib/utils";
import type { TopNavBarProps } from "./types";
import { menuContentClass, menuItemClass, menuTriggerClass } from "./menuStyles";

type DatasetMenuProps = Pick<
  TopNavBarProps,
  "openMappingList" | "datasetActions" | "onOpenDatasetReview"
>;

export function DatasetMenu({
  openMappingList,
  datasetActions,
  onOpenDatasetReview,
}: DatasetMenuProps) {
  const hfExportGate = datasetActions?.huggingFaceExportGate;
  const hfExportUnavailableReason = hfExportGate?.enabled
    ? undefined
    : hfExportGate?.unavailableReason;
  const loadFromHfLabel = datasetActions?.isImportingFromHF
    ? "Loading from HF..."
    : "From Hugging Face";
  const exportToHfLabel = datasetActions?.isUploadingToHF
    ? "Uploading to HF..."
    : hfExportGate
      ? withCredentialSuffix("To Hugging Face", hfExportGate)
      : "To Hugging Face";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(menuTriggerClass, "ml-1")}>Dataset</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-48", menuContentClass)}>
        <DropdownMenuItem onClick={openMappingList} className={menuItemClass}>
          Joint Mappings
        </DropdownMenuItem>

        {onOpenDatasetReview ? (
          <DropdownMenuItem
            onClick={onOpenDatasetReview}
            className={menuItemClass}
          >
            Dataset Review
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={menuItemClass}>Load Episodes</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-48", menuContentClass)}>
            <DropdownMenuItem
              onClick={() => datasetActions?.loadFromLocal()}
              disabled={!datasetActions}
              className={cn(menuItemClass, "disabled:opacity-50 disabled:cursor-not-allowed")}
            >
              From Local File
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => datasetActions?.loadFromHuggingFace()}
              disabled={!datasetActions || datasetActions.isImportingFromHF}
              className={cn(menuItemClass, "disabled:opacity-50 disabled:cursor-not-allowed")}
            >
              {loadFromHfLabel}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={menuItemClass}>Export Episodes</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-48", menuContentClass)}>
            <DropdownMenuItem
              onClick={() => datasetActions?.exportToLocal()}
              disabled={!datasetActions || !datasetActions.hasEpisodes || datasetActions.isExportingDataset}
              className={cn(menuItemClass, "disabled:opacity-50 disabled:cursor-not-allowed")}
            >
              {datasetActions?.isExportingDataset ? "Exporting..." : "To Local File"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => datasetActions?.exportToHuggingFace()}
              disabled={
                !datasetActions ||
                !datasetActions.hasEpisodes ||
                datasetActions.isUploadingToHF ||
                !datasetActions.huggingFaceExportGate.enabled
              }
              title={hfExportUnavailableReason}
              className={cn(menuItemClass, "disabled:opacity-50 disabled:cursor-not-allowed")}
            >
              {exportToHfLabel}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
