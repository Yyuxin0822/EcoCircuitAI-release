"""EcoCircuit image-upload, image-proxy, and diagram-export validation."""
import base64
import io
import math
import re
from pathlib import Path
from urllib.parse import urlsplit, unquote
from PIL import Image

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000

def allowed_s3_url(url):
    try:
        p = urlsplit(url)
        host = p.hostname or ""
        return (p.scheme == "https" and not p.username and not p.password
                and p.port in (None, 443) and not p.fragment
                and bool(re.fullmatch(r"ecocircuit\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com", host)))
    except (TypeError, ValueError):
        return False

def decode_image_upload(value):
    if not isinstance(value, str) or len(value) > MAX_IMAGE_BYTES * 4 // 3 + 128:
        raise ValueError("Image must be at most 10 MiB.")
    match = re.fullmatch(r"data:image/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)", value)
    if not match:
        raise ValueError("Upload a PNG, JPEG, or WebP image.")
    try:
        raw = base64.b64decode(match[1].replace("\r", "").replace("\n", ""), validate=True)
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG", "WEBP") or image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError()
            image.verify()
    except Exception as exc:
        raise ValueError("Invalid image or image exceeds the size limit.") from exc
    return raw

def static_export_data_uri(value, root_path):
    """Read only checked-in image assets below the two static directories."""
    p = urlsplit(value)
    path = unquote(p.path)
    if "\\" in path or "\x00" in path:
        raise ValueError("Invalid image path.")
    if path.startswith("/ecocircuit/static/"):
        base = Path(root_path) / "ecocircuit" / "static"
        relative = path[len("/ecocircuit/static/"):]
    elif path.startswith("/static/"):
        base = Path(root_path) / "static"
        relative = path[len("/static/"):]
    elif not p.scheme and not p.netloc and not path.startswith("/"):
        base = Path(root_path) / "ecocircuit" / "static"
        relative = path.removeprefix("static/")
    else:
        raise ValueError("Export images must be embedded or static assets.")
    base = base.resolve()
    target = (base / relative).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise ValueError("Invalid static image path.")
    mime = {".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
            ".webp":"image/webp", ".svg":"image/svg+xml"}.get(target.suffix.lower())
    if not mime or target.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError("Unsupported static image.")
    return "data:" + mime + ";base64," + base64.b64encode(target.read_bytes()).decode("ascii")

def validate_export_dimensions(width, height):
    if (not isinstance(width, (float, int)) or not isinstance(height, (float, int))
            or not math.isfinite(width) or not math.isfinite(height)
            or width <= 0 or height <= 0 or width > 12000 or height > 20000
            or width * height > 8_000_000):
        raise ValueError("Diagram dimensions exceed the export limit.")
