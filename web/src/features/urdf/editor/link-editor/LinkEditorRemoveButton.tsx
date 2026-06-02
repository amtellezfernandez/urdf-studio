import { Button } from "@/shared/ui/button";
import { Trash2 } from "lucide-react";

type LinkEditorRemoveButtonProps = {
  label: string;
  onRemove: () => void;
};

export const LinkEditorRemoveButton = ({
  label,
  onRemove,
}: LinkEditorRemoveButtonProps) => {
  return (
    <div className="pt-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-0 text-[9px] font-medium text-destructive/80 hover:bg-transparent hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="w-2.5 h-2.5 mr-0.5" />
        {label}
      </Button>
    </div>
  );
};
