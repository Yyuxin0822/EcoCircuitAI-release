"""Run with python -m unittest discover -s tests -p test_ecocircuit_resource_safety.py."""
import ast
import base64
import importlib.util
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("resource_safety", ROOT / "flaskr/ecocircuit/resource_safety.py")
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)

class ResourceTests(unittest.TestCase):
    def test_only_our_s3_bucket(self):
        self.assertTrue(safety.allowed_s3_url("https://ecocircuit.s3.amazonaws.com/a.jpg?X-Amz-Signature=test"))
        self.assertTrue(safety.allowed_s3_url("https://ecocircuit.s3.us-east-1.amazonaws.com/a.jpg"))
        for url in ("http://ecocircuit.s3.amazonaws.com/a", "https://evil.amazonaws.com/a",
                    "https://ecocircuit.s3.amazonaws.com@127.0.0.1/a",
                    "https://ecocircuit.s3.amazonaws.com.evil.test/a",
                    "https://ecocircuit.s3.amazonaws.com:8080/a", "file:///etc/passwd"):
            with self.subTest(url=url):
                self.assertFalse(safety.allowed_s3_url(url))

    def test_images_validate_content_not_just_filename(self):
        buf = io.BytesIO()
        Image.new("RGB", (2,2)).save(buf, format="PNG")
        value = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        self.assertEqual(safety.decode_image_upload(value), buf.getvalue())
        for value in ("data:image/png;base64," + base64.b64encode(b"not an image").decode(),
                      "data:image/svg+xml;base64,PHN2Zz4=", None, "data:image/png;base64,!!!!"):
            with self.assertRaises(ValueError):
                safety.decode_image_upload(value)

    def test_oversized_image_rejected_before_decoding(self):
        with self.assertRaises(ValueError):
            safety.decode_image_upload("x" * (safety.MAX_IMAGE_BYTES * 4 // 3 + 129))

    def test_static_asset_containment(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets = root / "ecocircuit/static"
            assets.mkdir(parents=True)
            (assets / "icon.png").write_bytes(b"test")
            (root / "secret.png").write_bytes(b"secret")
            self.assertTrue(safety.static_export_data_uri("/ecocircuit/static/icon.png", root).startswith("data:image/png;"))
            for url in ("/ecocircuit/static/../../secret.png",
                        "/ecocircuit/static/%2e%2e/%2e%2e/secret.png",
                        "file:///etc/passwd", "https://169.254.169.254/latest/meta-data/",
                        "/etc/passwd"):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    safety.static_export_data_uri(url, root)

    def test_render_dimensions_bounded(self):
        safety.validate_export_dimensions(1000, 5000)
        for width,height in ((0,10), (float("nan"),10), (12000,20000), (-1,20)):
            with self.assertRaises(ValueError):
                safety.validate_export_dimensions(width,height)

    def proxy(self, url, response=None):
        ns = {"request":SimpleNamespace(args={"url":url}), "allowed_s3_url":safety.allowed_s3_url,
              "jsonify":lambda data:data, "current_app":SimpleNamespace(logger=Mock()),
              "requests":SimpleNamespace(get=Mock(return_value=response), exceptions=SimpleNamespace(RequestException=OSError))}
        tree = ast.parse((ROOT/"flaskr/ecocircuit/routes.py").read_text())
        fn = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=="img_proxy")
        fn.decorator_list=[]
        exec(compile(ast.Module(body=[fn],type_ignores=[]),"routes.py","exec"),ns)
        return ns

    def test_proxy_blocks_before_network(self):
        ns=self.proxy("https://127.0.0.1/private")
        self.assertEqual(ns["img_proxy"]()[1],403)
        ns["requests"].get.assert_not_called()

    def test_proxy_does_not_follow_redirect(self):
        class Response:
            status_code=302
            def __enter__(self): return self
            def __exit__(self,*args): pass
        ns=self.proxy("https://ecocircuit.s3.amazonaws.com/a.jpg",Response())
        self.assertEqual(ns["img_proxy"]()[1],502)
        self.assertFalse(ns["requests"].get.call_args.kwargs["allow_redirects"])


    def test_export_preserves_embedded_images_and_local_fragment_references(self):
        import html
        import re
        tree = ast.parse((ROOT/"flaskr/ecocircuit/routes.py").read_text())
        fn = next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=="replace_image_url")
        with tempfile.TemporaryDirectory() as folder:
            assets=Path(folder)/"ecocircuit/static"
            assets.mkdir(parents=True)
            (assets/"icon.png").write_bytes(b"image")
            ns={"html":html,"static_export_data_uri":safety.static_export_data_uri,
                "current_app":SimpleNamespace(root_path=folder)}
            exec(compile(ast.Module(body=[fn],type_ignores=[]),"routes.py","exec"),ns)
            pattern = r'url\(["\x27]?([^)"\x27]+)["\x27]?\)'
            replace=lambda value: re.sub(pattern,ns["replace_image_url"],value)
            self.assertEqual(replace("url(#gradient)"),"url(#gradient)")
            self.assertEqual(replace("url(data:image/png;base64,AAAA)"),"url(data:image/png;base64,AAAA)")
            self.assertIn("url(&quot;data:image/png;base64,",replace("url(&quot;/ecocircuit/static/icon.png&quot;)"))
            with self.assertRaises(ValueError):
                replace("url(http://169.254.169.254/secret)")

    def test_proxy_rejects_oversized_download(self):
        class Response:
            status_code=200
            headers={"Content-Type":"image/png"}
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def iter_content(self,size):
                yield b"x" * (10*1024*1024+1)
        ns=self.proxy("https://ecocircuit.s3.amazonaws.com/a.jpg",Response())
        self.assertEqual(ns["img_proxy"]()[1],413)

if __name__ == "__main__":
    unittest.main()
