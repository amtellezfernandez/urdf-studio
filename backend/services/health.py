from backend.models.health import HealthResponse
from backend.services.yourdfpy_loader import yourdfpy_urdf_loader_available


def dependency_health() -> HealthResponse:
    """Simple health probe + dependency sanity."""
    yourdfpy_ok = yourdfpy_urdf_loader_available()

    return HealthResponse(status="ok", yourdfpy=yourdfpy_ok)
