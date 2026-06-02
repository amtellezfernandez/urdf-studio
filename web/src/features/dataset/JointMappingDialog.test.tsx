/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JointMappingDialog } from "@/features/dataset/JointMappingDialog";
import type { JointMapping } from "@/shared/types/feature";

const DIALOG_TEST_JOINT = "wrist_flex";
const DIALOG_TEST_APPLY_LABEL = "Load First Episode";
const DIALOG_TEST_RANGE = { min: 2, max: 3 };
const DIALOG_TEST_LIMITS = {
  [DIALOG_TEST_JOINT]: {
    type: "revolute",
    lower: -3,
    upper: -2,
  },
};

describe("JointMappingDialog", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
  });

  it("does not apply detected inversion unless the user explicitly enables it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onApply = vi.fn<(mappings: JointMapping[], degToRad: boolean) => void>();

    await act(async () => {
      root.render(
        createElement(JointMappingDialog, {
          isOpen: true,
          onClose: vi.fn(),
          datasetJoints: [DIALOG_TEST_JOINT],
          urdfJoints: [DIALOG_TEST_JOINT],
          jointRanges: {
            [DIALOG_TEST_JOINT]: DIALOG_TEST_RANGE,
          },
          jointLimits: DIALOG_TEST_LIMITS,
          onApply,
          applyLabel: DIALOG_TEST_APPLY_LABEL,
        })
      );
    });

    const applyButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes(DIALOG_TEST_APPLY_LABEL)
    );
    expect(applyButton).toBeTruthy();

    await act(async () => {
      applyButton?.click();
    });

    expect(onApply).toHaveBeenCalledWith(
      [{ datasetJoint: DIALOG_TEST_JOINT, urdfJoint: DIALOG_TEST_JOINT }],
      false
    );

    await act(async () => {
      root.unmount();
    });
  });
});
