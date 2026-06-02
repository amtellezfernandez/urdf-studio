from __future__ import annotations

from dataclasses import dataclass


BUTTERCLAW_SLASH_PREFIX = "/"
BUTTERCLAW_MOVE_ARGUMENT_COUNT_WITHOUT_STRAFE = 2
BUTTERCLAW_MOVE_ARGUMENT_COUNT_WITH_STRAFE = 3
BUTTERCLAW_ROTATE_REQUIRED_ARGUMENT_COUNT = 1
BUTTERCLAW_ROTATE_OPTIONAL_ARGUMENT_COUNT = 2
BUTTERCLAW_STRAFE_REQUIRED_ARGUMENT_COUNT = 2
BUTTERCLAW_STOP_REQUIRED_ARGUMENT_COUNT = 0
BUTTERCLAW_STATUS_REQUIRED_ARGUMENT_COUNT = 0
BUTTERCLAW_SCAN_MIN_ARGUMENT_COUNT = 0


@dataclass(frozen=True)
class ButterClawDirectCommandDefaults:
    move_timeout_seconds: float = 15.0
    motion_timeout_padding_seconds: float = 5.0
    rotate_theta_velocity_degrees_per_second: float = 45.0
    rotate_timeout_seconds: float = 20.0
    scan_timeout_seconds: float = 90.0
    stop_timeout_seconds: float = 10.0
    status_timeout_seconds: float = 10.0


BUTTERCLAW_DIRECT_COMMAND_DEFAULTS = ButterClawDirectCommandDefaults()
