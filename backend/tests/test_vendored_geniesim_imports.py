"""The vendored Genie Sim subset must import in a plain (Isaac-free) environment,
and patched files must differ from upstream only in the ways VENDORED.md logs."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path

REPO_ROOT = Path(__file__).resolve().parents[2]
VENDOR_ROOT = REPO_ROOT / "backend" / "vendor" / "geniesim" / "geniesim_benchmark"
UPSTREAM_ROOT = (
    REPO_ROOT
    / "third_party"
    / "genie_sim"
    / "source"
    / "geniesim_benchmark"
    / "src"
    / "geniesim_benchmark"
)

VERBATIM_FILES = (
    "plugins/logger/__init__.py",
    "plugins/logger/logger.py",
    "plugins/ader/__init__.py",
    "plugins/ader/ader_base.py",
    "plugins/ader/action/__init__.py",
    "plugins/ader/action/action_manager.py",
    "plugins/ader/action/common_actions.py",
    "plugins/ader/action/custom/inside.py",
    "plugins/ader/action/custom/inbbox.py",
    "plugins/ader/action/custom/ontop.py",
    "plugins/ader/action/custom/onfloor.py",
    "plugins/ader/action/custom/liftup.py",
    "plugins/ader/action/custom/stack.py",
    "plugins/output_system/__init__.py",
    "plugins/output_system/eval_utils.py",
    "plugins/__init__.py",
    "benchmark/__init__.py",
    "benchmark/policy/base.py",
    "utils/data_courier.py",
)


def test_vendored_modules_import_without_isaac() -> None:
    ensure_geniesim_on_path()

    from geniesim_benchmark.app.controllers.api_core import APICore
    from geniesim_benchmark.benchmark.policy.base import BasePolicy
    from geniesim_benchmark.plugins.ader import (
        ActionBase,
        ActionManager,
        AderEnv,
        AderParams,
        AderTask,
        do_parsing,
    )
    from geniesim_benchmark.plugins.ader.action.action_parsing import parse_action
    from geniesim_benchmark.plugins.ader.action.custom import (
        InBBox,
        Inside,
        LiftUp,
        Onfloor,
        Ontop,
        Stack,
        Upright,
    )
    from geniesim_benchmark.plugins.output_system.eval_utils import (
        EvaluationSummary,
        TaskEvaluation,
    )
    from geniesim_benchmark.utils.data_courier import DataCourier

    assert callable(parse_action) and callable(do_parsing)
    for symbol in (
        APICore, BasePolicy, ActionBase, ActionManager, AderEnv, AderParams, AderTask,
        InBBox, Inside, LiftUp, Onfloor, Ontop, Stack, Upright,
        EvaluationSummary, TaskEvaluation, DataCourier,
    ):
        assert symbol is not None


def test_vendored_tree_has_no_isaac_imports() -> None:
    for path in VENDOR_ROOT.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        for forbidden in ("import omni", "from omni", "import pxr", "from pxr", "import isaacsim", "from isaacsim"):
            assert forbidden not in source, f"{path} contains forbidden import: {forbidden}"


@pytest.mark.skipif(not UPSTREAM_ROOT.is_dir(), reason="third_party/genie_sim clone not present")
def test_verbatim_files_match_upstream() -> None:
    for relative in VERBATIM_FILES:
        vendored = (VENDOR_ROOT / relative).read_text(encoding="utf-8")
        upstream = (UPSTREAM_ROOT / relative).read_text(encoding="utf-8")
        assert vendored == upstream, f"{relative} is marked verbatim but differs from upstream"


@pytest.mark.skipif(not UPSTREAM_ROOT.is_dir(), reason="third_party/genie_sim clone not present")
def test_upright_patch_only_removes_isaacsim_import() -> None:
    vendored = (VENDOR_ROOT / "plugins/ader/action/custom/upright.py").read_text(encoding="utf-8")
    upstream = (UPSTREAM_ROOT / "plugins/ader/action/custom/upright.py").read_text(encoding="utf-8")
    expected = upstream.replace(
        "from isaacsim.core.utils.stage import get_current_stage\n", ""
    )
    assert vendored == expected
