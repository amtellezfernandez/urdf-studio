import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  WaypointRecorderPanel,
  type WaypointRecorderContext,
} from "@/features/scenarios/WaypointRecorderPanel";

type WaypointRecorderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: WaypointRecorderContext;
};

export const WaypointRecorderDialog = ({
  open,
  onOpenChange,
  context,
}: WaypointRecorderDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Motion Studio</DialogTitle>
        <DialogDescription>
          Pose, keyframe, replay, and save robot motion as a runnable scenario.
        </DialogDescription>
      </DialogHeader>
      {open && <WaypointRecorderPanel context={context} />}
    </DialogContent>
  </Dialog>
);
