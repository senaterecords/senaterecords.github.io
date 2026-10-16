import httpx
import pytest

from nyleg.api import ApiError, AuthError, Client, NotFound


def make_client(handler, **kwargs):
    sleeps: list[float] = []
    client = Client("test-key", transport=httpx.MockTransport(handler), min_interval=0, sleep=sleeps.append, **kwargs)
    return client, sleeps


def ok(payload):
    return httpx.Response(200, json={"success": True, **payload})


def test_get_sends_key_and_formats_params():
    seen = {}

    def handler(request):
        seen["url"] = request.url
        return ok({"result": {"items": []}})

    client, _ = make_client(handler)
    client.get("/transcripts/2025", full=True, sessionOnly=False)
    assert seen["url"].path == "/api/3/transcripts/2025"
    assert seen["url"].params["key"] == "test-key"
    assert seen["url"].params["full"] == "true"
    assert seen["url"].params["sessionOnly"] == "false"


def test_missing_key_raises_auth_error():
    with pytest.raises(AuthError, match="NYSENATE_API_KEY"):
        Client("")


def test_401_raises_auth_error():
    client, _ = make_client(lambda r: httpx.Response(401, json={"success": False, "errorCode": 701}))
    with pytest.raises(AuthError, match="rejected"):
        client.get("/transcripts")


def test_404_raises_not_found():
    client, _ = make_client(lambda r: httpx.Response(404, json={"success": False, "message": "Bill not found"}))
    with pytest.raises(NotFound):
        client.get("/bills/2025/S99999")


def test_success_false_is_an_error_even_with_http_200():
    client, _ = make_client(lambda r: httpx.Response(200, json={"success": False, "message": "Invalid parameter"}))
    with pytest.raises(ApiError, match="Invalid parameter"):
        client.get("/transcripts")


def test_retries_server_errors_with_backoff():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(503)
        return ok({"result": {"items": [1]}})

    client, sleeps = make_client(handler)
    assert client.get("/transcripts")["result"]["items"] == [1]
    assert sleeps == [2.0, 4.0]


def test_gives_up_after_max_retries():
    client, sleeps = make_client(lambda r: httpx.Response(500), max_retries=2)
    with pytest.raises(ApiError, match="Gave up"):
        client.get("/transcripts")
    assert sleeps == [2.0, 4.0]


def test_network_errors_are_retried():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("boom")
        return ok({"result": {}})

    client, sleeps = make_client(handler)
    client.get("/transcripts")
    assert sleeps == [2.0]


def test_iter_items_pages_with_one_based_offsets():
    offsets = []
    pages = {1: [1, 2], 3: [3, 4], 5: [5]}

    def handler(request):
        offset = int(request.url.params["offset"])
        offsets.append(offset)
        return ok({"result": {"items": pages[offset]}})

    client, _ = make_client(handler)
    assert list(client.iter_items("/hearings", page_size=2)) == [1, 2, 3, 4, 5]
    assert offsets == [1, 3, 5]


def test_throttle_spaces_out_requests():
    now = [100.0]
    sleeps = []

    def sleep(seconds):
        sleeps.append(round(seconds, 3))
        now[0] += seconds

    client = Client(
        "k",
        transport=httpx.MockTransport(lambda r: ok({"result": {}})),
        min_interval=1.0,
        sleep=sleep,
        clock=lambda: now[0],
    )
    client.get("/a")
    client.get("/b")
    assert sleeps == [1.0]
