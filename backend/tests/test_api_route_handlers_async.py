from __future__ import annotations

import ast
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1] / "api"
SYNC_SECURITY_DEPENDENCIES = {
    "require_simulator_operator_access",
}


def _route_decorators(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    return [
        ast.unparse(decorator)
        for decorator in node.decorator_list
        if ast.unparse(decorator).startswith(("router.", "http_router."))
    ]


def test_backend_api_route_handlers_are_async() -> None:
    sync_routes: list[str] = []
    for path in sorted(API_ROOT.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            if _route_decorators(node):
                sync_routes.append(f"{path.relative_to(API_ROOT.parent)}:{node.lineno}:{node.name}")

    assert sync_routes == []


def test_route_dependencies_use_async_security_guards() -> None:
    sync_dependency_uses: list[str] = []
    for path in sorted(API_ROOT.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Name) or node.func.id != "Depends":
                continue
            if not node.args:
                continue
            dependency = node.args[0]
            if isinstance(dependency, ast.Name) and dependency.id in SYNC_SECURITY_DEPENDENCIES:
                sync_dependency_uses.append(
                    f"{path.relative_to(API_ROOT.parent)}:{node.lineno}:{dependency.id}"
                )

    assert sync_dependency_uses == []
