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
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>Record Motion</DialogTitle>
        <DialogDescription>
          Pose the robot, capture keyframes, and save a runnable scenario — no code.
        </DialogDescription>
      </DialogHeader>
      {open && <WaypointRecorderPanel context={context} />}
    </DialogContent>
  </Dialog>
);
