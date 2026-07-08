import { useMemo, useState } from "react";
import { toast } from "sonner";

import { downloadJsonDocument } from "@/app/pages/index/worldSceneManagerHelpers";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { NumberInput } from "@/shared/ui/number-input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { saveAuthoredScenario } from "@/features/scenarios/scenariosApi";
import { useWaypointRecorder } from "@/features/scenarios/useWaypointRecorder";

export type WaypointRecorderContext = {
  getJointValues: () => Record<string, number>;
  setJointValues: (values: Record<string, number>) => void;
  buildWorldEnvelope: () => Promise<unknown>;
  worldObjectIds: string[];
  robotUrdf: string | null;
  robotLinks: string[];
};

const NONE = "__none__";

export const WaypointRecorderPanel = ({ context }: { context: WaypointRecorderContext }) => {
  const recorder = useWaypointRecorder({
    getJointValues: context.getJointValues,
    setJointValues: context.setJointValues,
  });
  const [scenarioName, setScenarioName] = useState("");
  const [targetObject, setTargetObject] = useState<string>("");
  const [containerObject, setContainerObject] = useState<string>("");
  const [attachLink, setAttachLink] = useState<string>(NONE);
  const [isSaving, setIsSaving] = useState(false);

  const objectOptions = context.worldObjectIds;
  const canSave = useMemo(
    () =>
      recorder.keyframes.length >= 2 &&
      scenarioName.trim().length > 0 &&
      Boolean(targetObject) &&
      Boolean(containerObject) &&
      (!recorder.usesAttach || attachLink !== NONE),
    [recorder.keyframes.length, recorder.usesAttach, scenarioName, targetObject, containerObject, attachLink]
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const world = await context.buildWorldEnvelope();
      const summary = await saveAuthoredScenario({
        name: scenarioName.trim(),
        world,
        waypoints: recorder.document,
        target_object_id: targetObject,
        container_object_id: containerObject,
        attach_link: recorder.usesAttach && attachLink !== NONE ? attachLink : null,
        robot_urdf: context.robotUrdf,
      });
      toast.success(`Saved scenario: ${summary.scenario_id}. Open Scenarios to run it.`);
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to save scenario."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {recorder.isRecording ? (
          <Button size="sm" variant="destructive" onClick={recorder.stopRecording}>
            ■ Stop
          </Button>
        ) : (
          <Button size="sm" onClick={recorder.startRecording}>
            ● Record
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={recorder.addKeyframe}>
          + Add keyframe
        </Button>
        {recorder.isReplaying ? (
          <Button size="sm" variant="outline" onClick={recorder.pauseReplay}>
            ⏸ Pause
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={recorder.replay}
            disabled={recorder.keyframes.length < 1}
          >
            ▶ Replay
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={recorder.clear}
          disabled={recorder.keyframes.length === 0}
        >
          Clear
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {recorder.keyframes.length} keyframe(s) · {recorder.duration.toFixed(2)}s
          {recorder.isReplaying ? ` · t=${recorder.previewTime.toFixed(2)}s` : ""}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Pose the robot with the viewer's IK targets or joint controls, then add a keyframe at
        each pose. Replay previews the interpolated motion; saving turns it into a runnable
        scenario.
      </p>

      <ScrollArea className="h-40 rounded-md border border-border/70">
        {recorder.keyframes.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No keyframes yet. Pose the robot and click “Add keyframe”.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">time (s)</th>
                <th className="px-2 py-1 text-left">attach</th>
                <th className="px-2 py-1 text-left">detach</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {recorder.keyframes.map((keyframe, index) => (
                <tr key={index} className="border-t border-border/50">
                  <td className="px-2 py-1">{index}</td>
                  <td className="px-2 py-1">
                    <NumberInput
                      value={keyframe.time_s}
                      min={0}
                      step={0.1}
                      onValueChange={(value) => recorder.setKeyframeTime(index, value)}
                      className="h-7 w-20"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={keyframe.attach ?? NONE}
                      onChange={(event) =>
                        recorder.setKeyframeAttach(
                          index,
                          event.target.value === NONE ? null : event.target.value
                        )
                      }
                      className="h-7 rounded border border-border/70 bg-background px-1"
                    >
                      <option value={NONE}>—</option>
                      {objectOptions.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={Boolean(keyframe.detach)}
                      onChange={(event) => recorder.setKeyframeDetach(index, event.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-red-500"
                      onClick={() => recorder.removeKeyframe(index)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>

      <div className="space-y-3 rounded-md border border-border/70 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Save as scenario
        </div>
        <Input
          placeholder="Scenario name"
          value={scenarioName}
          onChange={(event) => setScenarioName(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">target object</span>
            <select
              value={targetObject}
              onChange={(event) => setTargetObject(event.target.value)}
              className="h-8 w-full rounded border border-border/70 bg-background px-2"
            >
              <option value="">select…</option>
              {objectOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">goal / container</span>
            <select
              value={containerObject}
              onChange={(event) => setContainerObject(event.target.value)}
              className="h-8 w-full rounded border border-border/70 bg-background px-2"
            >
              <option value="">select…</option>
              {objectOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        </div>
        {recorder.usesAttach && (
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">attach link (required for attach)</span>
            <select
              value={attachLink}
              onChange={(event) => setAttachLink(event.target.value)}
              className="h-8 w-full rounded border border-border/70 bg-background px-2"
            >
              <option value={NONE}>select…</option>
              {context.robotLinks.map((link) => (
                <option key={link} value={link}>
                  {link}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void handleSave()} disabled={!canSave || isSaving}>
            Save as scenario
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadJsonDocument(recorder.document, `${scenarioName.trim() || "recording"}.waypoints.json`)
            }
            disabled={recorder.keyframes.length === 0}
          >
            Download waypoints.json
          </Button>
        </div>
      </div>
    </div>
  );
};
