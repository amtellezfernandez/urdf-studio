import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  createMotionClip,
  readMotionLibrary,
  writeMotionLibrary,
  type MotionClip,
} from "@/features/scenarios/motionLibrary";
import type { RecordedKeyframe } from "@/features/scenarios/waypointRecording";

export const MotionLibraryPanel = ({
  keyframes,
  onLoad,
}: {
  keyframes: RecordedKeyframe[];
  onLoad: (keyframes: RecordedKeyframe[]) => void;
}) => {
  const [clips, setClips] = useState<MotionClip[]>(() => readMotionLibrary());
  const [name, setName] = useState("");

  const save = () => {
    if (!name.trim() || keyframes.length === 0) return;
    const next = [createMotionClip(name, keyframes), ...clips];
    writeMotionLibrary(next);
    setClips(next);
    setName("");
  };

  const remove = (clipId: string) => {
    const next = clips.filter((clip) => clip.id !== clipId);
    writeMotionLibrary(next);
    setClips(next);
  };

  return (
    <section className="space-y-2 rounded-md border border-border/70 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motion Library</div>
      <div className="flex gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Clip name" />
        <Button size="sm" variant="outline" onClick={save} disabled={!name.trim() || keyframes.length === 0}>Save Clip</Button>
      </div>
      {clips.length === 0 ? (
        <p className="text-xs text-muted-foreground">Save a keyed motion to reuse it here.</p>
      ) : (
        <div className="max-h-28 space-y-1 overflow-auto">
          {clips.map((clip) => (
            <div key={clip.id} className="flex items-center gap-2 rounded bg-muted/35 px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate">{clip.name}</span>
              <span className="text-muted-foreground">{clip.keyframes.length} keys</span>
              <button type="button" className="text-primary hover:underline" onClick={() => onLoad(clip.keyframes)}>Load</button>
              <button type="button" className="text-muted-foreground hover:text-red-500" onClick={() => remove(clip.id)} aria-label={`Delete ${clip.name}`}>×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
