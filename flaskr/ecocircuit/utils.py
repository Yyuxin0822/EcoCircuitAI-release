import os
import openai
import asyncio
from openai import AsyncOpenAI

from dotenv import load_dotenv
from flaskr.account.api_utils import APIUsageTracker

load_dotenv()


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
clientasync = AsyncOpenAI(api_key=OPENAI_API_KEY)

def get_user_async_client(user_api_key: str) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=user_api_key)

class GenerationAPIError(RuntimeError):
    """Safe error text for the existing socket error responses."""


def _quota_exhausted(error):
    body = getattr(error, "body", None)
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        body = body["error"]
    body = body if isinstance(body, dict) else {}
    values = (getattr(error, "code", None), getattr(error, "type", None),
              body.get("code"), body.get("type"))
    return any(value in ("insufficient_quota", "credit_balance_exhausted")
               for value in values)


def _api_error_message(error, server_image=False):
    account = "The server's image-generation API account" if server_image else "The API account associated with your saved key"
    status = getattr(error, "status_code", None)
    if _quota_exhausted(error):
        return account + " has no available quota or credits. Restore API billing before trying again."
    if status == 401:
        return ("The server's image-generation API key is invalid. Contact the app administrator."
                if server_image else "Your API key is invalid or expired. Update it in your account settings.")
    if status in (403, 404):
        return account + " cannot access the requested model. Check its model permissions."
    if status == 429:
        return "The API is temporarily rate-limited. Please wait and try again."
    if isinstance(error, (asyncio.TimeoutError, openai.APITimeoutError)):
        return "The generation request timed out. Please try again later."
    if isinstance(error, openai.APIConnectionError):
        return "The app could not connect to the API. Please try again later."
    if status is not None and status >= 500:
        return "The API service is temporarily unavailable. Please try again later."
    if server_image:
        return "Image generation was rejected. Check the server image-model configuration or try a different description."
    return "The API rejected this generation request. Check your input and try again."


def _retry_delay(error, attempt):
    from email.utils import parsedate_to_datetime
    import time
    import random

    headers = getattr(getattr(error, "response", None), "headers", {})
    try:
        if headers.get("retry-after-ms") is not None:
            return max(0.0, float(headers["retry-after-ms"]) / 1000)
        value = headers.get("retry-after")
        if value is not None:
            try:
                return max(0.0, float(value))
            except ValueError:
                return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
    except (TypeError, ValueError, OverflowError):
        pass
    return (2 ** attempt) + random.uniform(0, 1)


async def async_completions_with_backoff(clientasync_unused, usage_tracker: APIUsageTracker, image_request=False, **kwargs):
    # Route by operation, independently of the selected image model.
    server_image = image_request
    source_client = clientasync if server_image else clientasync_unused
    request_timeout = 120.0 if server_image else 60.0
    request_client = source_client.with_options(max_retries=0, timeout=request_timeout)
    messages = kwargs.get("messages", [])
    has_image = any(
        isinstance(content, dict) and content.get("type") == "image_url"
        for msg in messages
        for content in (msg.get("content") or [])
    )

    async def request_once():
        if server_image:
            return await request_client.images.generate(**kwargs)
        if has_image:
            return await request_client.chat.completions.create(**kwargs)
        return await request_client.beta.chat.completions.parse(**kwargs)

    # 180-second total deadline includes requests and retry delays.
    deadline = asyncio.get_running_loop().time() + 180.0
    for attempt in range(3):
        remaining = deadline - asyncio.get_running_loop().time()
        try:
            if remaining <= 0:
                raise asyncio.TimeoutError()
            response = await asyncio.wait_for(request_once(), timeout=min(request_timeout, remaining))
        except (openai.OpenAIError, asyncio.TimeoutError) as error:
            status = getattr(error, "status_code", None)
            transient = (
                isinstance(error, (openai.APIConnectionError, asyncio.TimeoutError))
                or status in (408, 409, 429)
                or (status is not None and status >= 500)
            )
            if _quota_exhausted(error) or not transient or attempt == 2:
                raise GenerationAPIError(_api_error_message(error, server_image)) from None
            delay = _retry_delay(error, attempt)
            remaining = deadline - asyncio.get_running_loop().time()
            if delay >= remaining:
                raise GenerationAPIError(_api_error_message(error, server_image)) from None
            await asyncio.sleep(delay)
        else:
            # Accounting failures must never replay a successful paid API request.
            if usage_tracker is not None:
                if server_image:
                    usage_tracker.log_image(len(response.data))
                elif response.usage is not None:
                    usage_tracker.log_chat(response.usage.prompt_tokens, response.usage.completion_tokens)
            return response


##############other utils################
import boto3
s3 = boto3.client('s3')


import asyncio
from functools import wraps

def make_hashable(x):
    if isinstance(x, (list, tuple)):
        return tuple(make_hashable(e) for e in x)
    if isinstance(x, dict):
        return tuple(sorted((k, make_hashable(v)) for k, v in x.items()))
    return x

def async_memoize(func):
    cache = {}

    @wraps(func)
    async def memoized_func(*args, **kwargs):
        key = (make_hashable(args), make_hashable(kwargs))
        if key not in cache:
            cache[key] = await func(*args, **kwargs)
        return cache[key]

    return memoized_func


##############access decorator################
from functools import wraps
from flask import session, abort

def access_required(f):
    """Decorator to check project access permissions"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get project id from the route parameter
        project_id = kwargs.get('id')
        
        if project_id:
            # Import here to avoid circular imports
            from flaskr.ecocircuit import models as model
            
            # Get project data
            project = model.get_project_by_id(project_id)
            
            # Get access field and print it (use bracket notation for sqlite3.Row)
            access = project["access"] if project else "unknown"
            print(f"Access for project {project_id}: {access}")
        
        return f(*args, **kwargs)
    return decorated_function


