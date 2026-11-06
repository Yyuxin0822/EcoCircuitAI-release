"""Offline regression checks: python -m unittest discover -s tests -p 'test_api_retries.py'.

Load only the retry helper definitions to avoid app/DB/S3 initialization.
SDK exceptions and clients are simulated; no credentials or network are used.
"""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

class APIError(Exception):
    def __init__(self, status=None, body=None):
        super().__init__("SENSITIVE RAW PROVIDER ERROR")
        self.status_code = status
        self.body = body
        self.response = SimpleNamespace(headers={})

class ConnectionError(APIError):
    pass

class TimeoutError(ConnectionError):
    pass

def offline_test(function):
    def run(self):
        coroutine = function(self)
        try:
            coroutine.send(None)
        except StopIteration:
            return
        finally:
            coroutine.close()
        raise AssertionError("Unexpected real asynchronous I/O")
    return run

async def immediate_wait(awaitable, timeout):
    return await awaitable

async def immediate_sleep(delay):
    pass

class RetryTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[1] / "flaskr/ecocircuit/utils.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        names = {"GenerationAPIError", "_quota_exhausted", "_api_error_message",
                 "_retry_delay", "async_completions_with_backoff"}
        subset = ast.Module(body=[n for n in tree.body if getattr(n, "name", None) in names], type_ignores=[])
        self.clock = SimpleNamespace(time=lambda: 0)
        self.offline_asyncio = SimpleNamespace(TimeoutError=asyncio.TimeoutError,
            wait_for=immediate_wait, sleep=immediate_sleep, get_running_loop=lambda: self.clock)
        self.ns = {"asyncio": self.offline_asyncio, "APIUsageTracker": object,
                   "openai": SimpleNamespace(OpenAIError=APIError,
                       APIConnectionError=ConnectionError, APITimeoutError=TimeoutError)}
        exec(compile(subset, str(path), "exec"), self.ns)
        self.response = SimpleNamespace(usage=SimpleNamespace(prompt_tokens=2, completion_tokens=3), data=[1])
        self.call = AsyncMock(return_value=self.response)
        self.client = Mock()
        self.client.with_options.return_value = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=self.call)),
            beta=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=self.call))),
            images=SimpleNamespace(generate=self.call))
        self.ns["clientasync"] = self.client
        self.tracker = Mock()
        self.ns["_retry_delay"] = lambda error, attempt: 0
        self.kwargs = {"model": "gpt-4o", "messages": [{"content": [{"type": "image_url"}]}]}

    async def run_call(self):
        return await self.ns["async_completions_with_backoff"](self.client, self.tracker, **self.kwargs)

    @offline_test
    async def test_quota_stops_once_and_hides_raw_error(self):
        for body in ({"code": "credit_balance_exhausted"}, {"error": {"type": "insufficient_quota"}}):
            self.call.reset_mock()
            self.call.side_effect = APIError(429, body)
            with self.assertRaisesRegex(self.ns["GenerationAPIError"], "quota or credits") as caught:
                await self.run_call()
            self.assertNotIn("SENSITIVE", str(caught.exception))
            self.assertEqual(self.call.await_count, 1)
        self.tracker.log_chat.assert_not_called()

    @offline_test
    async def test_permanent_errors_stop_once(self):
        for status in (400, 401, 403, 404, 422):
            self.call.reset_mock()
            self.call.side_effect = APIError(status)
            with self.assertRaises(self.ns["GenerationAPIError"]):
                await self.run_call()
            self.assertEqual(self.call.await_count, 1)

    @offline_test
    async def test_transient_errors_stop_after_three(self):
        for error in (APIError(429), APIError(500), APIError(503), ConnectionError(), TimeoutError()):
            self.call.reset_mock()
            self.call.side_effect = error
            with self.assertRaises(self.ns["GenerationAPIError"]):
                await self.run_call()
            self.assertEqual(self.call.await_count, 3)

    @offline_test
    async def test_recovers_and_accounts_once(self):
        self.call.side_effect = [APIError(503), self.response]
        self.assertIs(await self.run_call(), self.response)
        self.assertEqual(self.call.await_count, 2)
        self.tracker.log_chat.assert_called_once_with(2, 3)
        self.client.with_options.assert_called_once_with(max_retries=0, timeout=60.0)

    @offline_test
    async def test_accounting_error_does_not_repeat_request(self):
        self.tracker.log_chat.side_effect = APIError(500)
        with self.assertRaises(APIError):
            await self.run_call()
        self.assertEqual(self.call.await_count, 1)

    @offline_test
    async def test_long_retry_after_stops(self):
        self.ns["_retry_delay"] = lambda error, attempt: 600
        self.call.side_effect = APIError(429)
        with self.assertRaises(self.ns["GenerationAPIError"]):
            await self.run_call()
        self.assertEqual(self.call.await_count, 1)

    @offline_test
    async def test_total_deadline_stops(self):
        self.call.side_effect = APIError(503)
        loop = SimpleNamespace(time=Mock(side_effect=[0, 0, 181]))
        with patch.object(self.offline_asyncio, "get_running_loop", return_value=loop):
            with self.assertRaises(self.ns["GenerationAPIError"]):
                await self.run_call()
        self.assertEqual(self.call.await_count, 1)

    @offline_test
    async def test_cancel_propagates(self):
        self.call.side_effect = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.run_call()
        self.assertEqual(self.call.await_count, 1)

    @offline_test
    async def test_text_and_server_image_routes(self):
        self.kwargs = {"model": "gpt-4o", "messages": [{"content": "plain text"}]}
        await self.run_call()
        self.kwargs = {"model": "gpt-image-2.5-flare", "prompt": "test", "image_request": True}
        other_user_client = Mock()
        await self.ns["async_completions_with_backoff"](other_user_client, self.tracker, **self.kwargs)
        other_user_client.with_options.assert_not_called()
        self.tracker.log_image.assert_called_once_with(1)

if __name__ == "__main__":
    unittest.main()
