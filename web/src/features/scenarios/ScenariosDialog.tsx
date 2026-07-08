import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ScenariosPanel } from "@/features/scenarios/ScenariosPanel";

type ScenariosDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ScenariosDialog = ({ open, onOpenChange }: ScenariosDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>Scenarios</DialogTitle>
        <DialogDescription>
          Run a task, robot, and policy across simulators and compare the results.
        </DialogDescription>
      </DialogHeader>
      {open && <ScenariosPanel />}
    </DialogContent>
  </Dialog>
);
