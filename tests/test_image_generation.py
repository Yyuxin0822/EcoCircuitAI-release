"""Offline image migration checks; no credentials, paid API calls, or S3 access."""
import ast
import asyncio
import base64
import binascii
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import openai
from PIL import Image
import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_definitions(path, names, namespace):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    subset = ast.Module(body=[node for node in tree.body
        if getattr(node, "name", None) in names], type_ignores=[])
    exec(compile(subset, path, "exec"), namespace)
    return namespace


def image_namespace():
    return load_definitions("flaskr/ecocircuit/method/_task/image.py", {"ImageTask"}, {
        "Task": type("Task", (), {"__init__": lambda self, *args: None}),
        "GenerationAPIError": RuntimeError, "base64": base64, "binascii": binascii,
        "Image": Image, "BytesIO": BytesIO, "s3": Mock(),
        "current_app": SimpleNamespace(config={"CACHE_MAX_AGE": 3600}),
    })


def encoded_image():
    buffer = BytesIO()
    Image.new("RGB", (2, 2), "green").save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def test_image_request_uses_server_sdk_and_serializes_new_parameters():
    async def run():
        import json
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"created": 1, "data": [{"b64_json": encoded_image()}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            async with openai.AsyncOpenAI(api_key="offline-test", http_client=http) as server:
                ns = load_definitions("flaskr/ecocircuit/utils.py", {
                    "GenerationAPIError", "_quota_exhausted", "_api_error_message",
                    "_retry_delay", "async_completions_with_backoff",
                }, {"asyncio": asyncio, "openai": openai, "APIUsageTracker": object, "clientasync": server})
                user = Mock()
                tracker = Mock()
                image = image_namespace()["ImageTask"]()
                async def completion(**kwargs):
                    return await ns["async_completions_with_backoff"](user, tracker, **kwargs)
                image.completion = completion
                raw = await image.genimage("A floating city")
                assert Image.open(BytesIO(raw)).format == "JPEG"
                user.with_options.assert_not_called()
                tracker.log_image.assert_called_once_with(1)
                tracker.log_chat.assert_not_called()
                assert len(requests) == 1
                assert requests[0].url.path == "/v1/images/generations"
                assert json.loads(requests[0].content) == {
                    "model": "gpt-image-2.5-flare", "prompt": "A floating city, photorealistic",
                    "n": 1, "size": "1024x1024", "quality": "medium", "output_format": "jpeg",
                }
    asyncio.run(run())


@pytest.mark.parametrize("data", [[], [SimpleNamespace(b64_json=None)], [SimpleNamespace(b64_json="invalid!")],
    [SimpleNamespace(b64_json=base64.b64encode(b"not an image").decode())]])
def test_bad_image_responses_fail_clearly(data):
    image = image_namespace()["ImageTask"]()
    image.completion = AsyncMock(return_value=SimpleNamespace(data=data))
    with pytest.raises(RuntimeError, match="image data"):
        asyncio.run(image.genimage("test"))


def test_generated_bytes_are_uploaded_as_jpeg_then_signed():
    ns = image_namespace()
    cls = ns["ImageTask"]
    image = cls()
    image.genimage = AsyncMock(return_value=b"jpeg-bytes")
    cls.s3_genurl = Mock(return_value="https://example.invalid/project.jpg")
    asyncio.run(image.gen_output({"env": "floating city", "id": "project"}))
    ns["s3"].put_object.assert_called_once_with(Bucket="ecocircuit", Key="project.jpg",
        Body=b"jpeg-bytes", ContentType="image/jpeg", CacheControl="max-age=3600,public", ACL="private")
    cls.s3_genurl.assert_called_once_with("project.jpg")
    assert image.output == "https://example.invalid/project.jpg"


def test_upload_failure_stops_before_signing_or_regenerating():
    ns = image_namespace()
    cls = ns["ImageTask"]
    image = cls()
    image.genimage = AsyncMock(return_value=b"jpeg-bytes")
    cls.s3_genurl = Mock()
    ns["s3"].put_object.side_effect = RuntimeError("private provider details")
    with pytest.raises(RuntimeError, match="could not be saved") as caught:
        asyncio.run(image.gen_output({"env": "city", "id": "project"}))
    assert "private" not in str(caught.value)
    image.genimage.assert_awaited_once()
    cls.s3_genurl.assert_not_called()


def test_missing_signed_url_reports_storage_failure():
    ns = image_namespace()
    image = ns["ImageTask"]()
    image.genimage = AsyncMock(return_value=b"jpeg-bytes")
    ns["ImageTask"].s3_genurl = Mock(return_value=None)
    with pytest.raises(RuntimeError, match="could not be accessed"):
        asyncio.run(image.gen_output({"env": "city", "id": "project"}))


def test_usage_does_not_apply_retired_dalle_price():
    ns = load_definitions("flaskr/account/api_utils.py", {"APIUsageTracker"},
        {"dataclass": dataclass, "field": field})
    tracker = ns["APIUsageTracker"]()
    tracker.log_chat(1000, 1000)
    assert tracker.report()["total_api_cost_usd"] == pytest.approx(0.0125)
    tracker.log_image()
    report = tracker.report()
    assert report["total_api_cost_usd"] is None
    assert report["image_model"] == "gpt-image-2.5-flare"
    assert report["images_generated"] == 1
