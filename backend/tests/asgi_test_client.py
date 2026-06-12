from __future__ import annotations

import asyncio
from typing import Any

from httpx import ASGITransport, AsyncClient, Response


TEST_BASE_URL = "http://testserver"
DEFAULT_TEST_CLIENT = ("testclient", 50000)


class AsgiTestClient:
    def __init__(
        self,
        app,
        *,
        client: tuple[str, int] = DEFAULT_TEST_CLIENT,
        base_url: str = TEST_BASE_URL,
    ) -> None:
        self._app = app
        self._client = client
        self._base_url = base_url

    def request(self, method: str, path: str, **kwargs: Any) -> Response:
        return asyncio.run(self._request(method, path, **kwargs))

    async def _request(self, method: str, path: str, **kwargs: Any) -> Response:
        transport = ASGITransport(app=self._app, client=self._client)
        async with AsyncClient(transport=transport, base_url=self._base_url) as client:
            return await client.request(method, path, **kwargs)

    def get(self, path: str, **kwargs: Any) -> Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Response:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> Response:
        return self.request("PUT", path, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Response:
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Response:
        return self.request("DELETE", path, **kwargs)
