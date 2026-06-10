from __future__ import annotations

from dataclasses import dataclass

from backend.models.simulator_runtime import (
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenRequest,
    SimulatorWorldOpenResponse,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorCapabilityError,
    build_simulator_runtime_status,
)


@dataclass(frozen=True)
class OptionalSimulatorAdapter:
    spec: SimulatorRuntimeSpec

    @property
    def simulator_id(self) -> SimulatorId:
        return self.spec.simulator_id

    @property
    def label(self) -> str:
        return self.spec.label

    @property
    def capabilities(self) -> SimulatorRuntimeCapabilities:
        return self.spec.capabilities_model()

    def open_world(self, _request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
        raise SimulatorCapabilityError(
            f"{self.label} is registered for runtime discovery, but world launch is not available yet."
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        return build_simulator_runtime_status(
            self.spec,
            missing_status_prefix="Missing optional dependency",
        )


def make_optional_simulator_adapter(
    *,
    spec: SimulatorRuntimeSpec,
) -> SimulatorAdapter:
    return OptionalSimulatorAdapter(spec=spec)
