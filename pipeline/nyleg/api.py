"""Client for the NY Senate Open Legislation API (v3)."""
from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx

BASE_URL = "https://legislation.nysenate.gov/api/3"
MAX_LIMIT = 1000


class ApiError(Exception):
    """The API could not be reached or returned an unusable response."""


class AuthError(ApiError):
    """The API key is missing or was rejected."""


class NotFound(ApiError):
    """The API has no record at this path (HTTP 404)."""


def _fmt(value: Any) -> Any:
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


class Client:
    """Throttled, retrying API client. The key is sent only as the `key` query parameter."""

    def __init__(
        self,
        key: str,
        *,
        base_url: str = BASE_URL,
        transport: httpx.BaseTransport | None = None,
        min_interval: float = 1.0,
        max_retries: int = 4,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not key:
            raise AuthError("NY Senate API key is missing: set NYSENATE_API_KEY")
        self._key = key
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=60.0)
        self._min_interval = min_interval
        self._max_retries = max_retries
        self._sleep = sleep
        self._clock = clock
        self._last: float | None = None

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        query = {k: _fmt(v) for k, v in params.items() if v is not None}
        query["key"] = self._key
        delay = 2.0
        for attempt in range(self._max_retries + 1):
            self._throttle()
            try:
                resp = self._http.get(path, params=query)
            except httpx.TransportError as exc:
                problem = f"network error: {exc}"
            else:
                if resp.status_code == 401:
                    raise AuthError("NY Senate API key rejected")
                if resp.status_code == 404:
                    raise NotFound(f"Not found: {path}")
                if resp.status_code < 500 and resp.status_code != 429:
                    return self._parse(resp, path)
                problem = f"HTTP {resp.status_code}"
            if attempt == self._max_retries:
                raise ApiError(f"Gave up on {path} after {attempt + 1} attempts ({problem})")
            self._sleep(delay)
            delay *= 2
        raise AssertionError("unreachable")

    def iter_items(self, path: str, *, page_size: int = MAX_LIMIT, **params: Any) -> Iterator[dict[str, Any]]:
        """Yield every item of a list endpoint. Offsets start at 1; stop at the first short page."""
        offset = 1
        while True:
            body = self.get(path, limit=page_size, offset=offset, **params)
            items = (body.get("result") or {}).get("items") or []
            yield from items
            if len(items) < page_size:
                return
            offset += len(items)

    def _throttle(self) -> None:
        if self._last is not None:
            wait = self._min_interval - (self._clock() - self._last)
            if wait > 0:
                self._sleep(wait)
        self._last = self._clock()

    @staticmethod
    def _parse(resp: httpx.Response, path: str) -> dict[str, Any]:
        try:
            body = resp.json()
        except ValueError as exc:
            raise ApiError(f"Response from {path} was not JSON (HTTP {resp.status_code})") from exc
        if resp.status_code >= 400 or not isinstance(body, dict) or body.get("success") is False:
            message = body.get("message") if isinstance(body, dict) else None
            raise ApiError(f"API error from {path}: {message or f'HTTP {resp.status_code}'}")
        return body
