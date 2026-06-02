import { Badge } from "@/shared/ui/badge";

import type { RosVizDataSource } from "@/runtime_engine/rosviz/types";

type RosVizStatusBadgesProps = {
  status: string;
  dataSource: RosVizDataSource;
  fixedFrame: string;
  deterministicMode: string;
  zoomPercent: number;
  resolvedPoseCount: number;
  markerCount: number;
  framesReceived: number;
  sequenceGapCount: number;
};

export const RosVizStatusBadges = ({
  status,
  dataSource,
  fixedFrame,
  deterministicMode,
  zoomPercent,
  resolvedPoseCount,
  markerCount,
  framesReceived,
  sequenceGapCount,
}: RosVizStatusBadgesProps) => (
  <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
    <Badge variant="outline" className="bg-background/80 text-[10px] font-mono">
      viz2 {status}
    </Badge>
    <Badge variant="outline" className="bg-background/80 text-[10px] font-mono">
      source {dataSource}
    </Badge>
    <Badge variant="outline" className="bg-background/80 text-[10px] font-mono">
      frame {fixedFrame}
    </Badge>
    <Badge variant="outline" className="bg-background/80 text-[10px] font-mono">
      det {deterministicMode}
    </Badge>
    <Badge variant="outline" className="bg-background/80 text-[10px] font-mono">
      scene p{resolvedPoseCount} m{markerCount}
    </Badge>
    <Badge variant="outline" className="bg-background/80 text-[10px] font-mono">
      stream {framesReceived} gap {sequenceGapCount}
    </Badge>
    <Badge variant="outline" className="bg-background/80 text-[10px] font-mono">
      zoom {zoomPercent}%
    </Badge>
  </div>
);
