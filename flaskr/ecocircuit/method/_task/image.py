import time
import base64
import binascii
from flaskr.ecocircuit.method import Task
from flaskr.ecocircuit.utils import s3, GenerationAPIError
import requests
import logging
from pydantic import BaseModel
from PIL import Image
from urllib.parse import urlparse
from io import BytesIO
from flask import current_app
import flaskr.ecocircuit.models as model
import json


class ImageTask(Task):
    task_message = "Preparing description and image ..."

    def __init__(self, clientasync=None, usage_tracker=None):
        super().__init__(clientasync, usage_tracker)
        self.name = "image"

    async def gen_output(self, data) -> str:
        if data.get("env") and not data.get("image"):
            img = await self.genimage(data["env"])
            try:
                s3.put_object(
                    Bucket="ecocircuit",
                    Key=f"{data['id']}.jpg",
                    Body=img,
                    ContentType="image/jpeg",
                    CacheControl=f"max-age={current_app.config['CACHE_MAX_AGE']},public",
                    ACL="private",
                )
            except Exception:
                raise GenerationAPIError("The generated image could not be saved to storage.") from None
            self.output = ImageTask.s3_genurl(f"{data['id']}.jpg")
            if not self.output:
                raise GenerationAPIError("The generated image was saved but could not be accessed.")
        elif data.get("image") and not data.get("env"):
            env = await self.genimagedescription(
                data["image"]
            )  # data["image"] is the image url
            self.name = "env"
            self.output = env
        else:
            return None
        return self

    def parse_output(self):
        self.parsed_output = self.output
        return self

    def test_output(self):
        # the is one situation where the url is not returned coorectly
        # esssentially I need a url validation function
        return True

    async def genimage(self, envir_description):
        response = await self.completion(
            image_request=True,
            model="gpt-image-2.5-flare",
            quality="medium",
            extra_body={"output_format": "jpeg"},
            prompt=f"{envir_description}, photorealistic",
            n=1,
            size="1024x1024",
        )
        if not response.data or not response.data[0].b64_json:
            raise GenerationAPIError("Image generation returned no image data.")
        try:
            raw = base64.b64decode(response.data[0].b64_json, validate=True)
            # Normalize the returned bytes to match the existing .jpg object key.
            with Image.open(BytesIO(raw)) as image:
                output = BytesIO()
                image.convert("RGB").save(output, format="JPEG")
            return output.getvalue()
        except (ValueError, binascii.Error, OSError):
            raise GenerationAPIError("Image generation returned invalid image data.") from None

    async def genimagedescription(self, imgurl):
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "What is in this image? Provide me with a Dalle image description.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"{imgurl}"},
                        },
                    ],
                }
            ],
            n=1,
            max_tokens=300,
        )

        description = response.choices[0].message.content

        if description.startswith("Sorry"):
            raise Exception(description)
        return description

    @staticmethod
    def s3_upload(file_or_url, object_name, bucket_name="ecocircuit"):
        cache_control = f"max-age={current_app.config['CACHE_MAX_AGE']},public"
        try:
            parsed = urlparse(file_or_url)
            if parsed.scheme in ("http", "https"):
                # 1) Download remote data
                resp = requests.get(file_or_url)
                resp.raise_for_status()
                body = resp.content
                # 2) Upload via put_object so we can set metadata
                s3.put_object(
                    Bucket=bucket_name,
                    Key=object_name,
                    Body=body,
                    ContentType=resp.headers.get(
                        "Content-Type", "application/octet-stream"
                    ),
                    CacheControl=cache_control,
                    ACL="private",
                )

            else:
                # 1) Open local file
                with open(file_or_url, "rb") as fp:
                    # 2) Upload via upload_fileobj with ExtraArgs for metadata
                    s3.upload_fileobj(
                        Fileobj=fp,
                        Bucket=bucket_name,
                        Key=object_name,
                        ExtraArgs={
                            "CacheControl": cache_control,
                            "ACL": "private",
                            "ContentType": "image/png",  # or detect via mimetypes
                        },
                    )

            logging.info("Upload successful!")

        except Exception as e:
            logging.error(f"Error uploading file: {e}")

    @staticmethod
    def s3_genurl(object_name, bucket_name="ecocircuit", isThumbnails=False):
        # print("current object name:", object_name)
        # object_name = c486f8b2-7479-43a0-aaef-99072bafa77c.jpg
        project_id = object_name.split(".")[0] if not isThumbnails else object_name.split("_")[0]
        
        if isThumbnails:
            # Always re-sign each thumbnail independently. A shared database expiry
            # cannot establish that both previously signed URLs are still valid.
            if not object_name.endswith(("_matrix_io.jpg", "_matrix_metabolism.jpg")):
                return None
            try:
                return s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": bucket_name, "Key": object_name},
                    ExpiresIn=min(current_app.config["PRESIGNED_TTL_SECONDS"], 900),
                )
            except Exception:
                logging.warning("Unable to sign thumbnail URL")
                return None
        else:
            img_url, expires_at = model.get_or_update_img_url_and_expires_at_by_id(project_id)
            now = int(time.time()) 
            if img_url and expires_at is not None and expires_at > now + current_app.config["SAFE_BUFFER"]:
                return img_url

        try:
            response = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket_name, "Key": object_name},
                ExpiresIn=current_app.config["PRESIGNED_TTL_SECONDS"],
            )

            # Simple validation with HTTP HEAD request
            get_resp = requests.get(response, stream=True, allow_redirects=True, timeout=(5, 10))
            if get_resp.status_code == 200:
                get_resp.close()
                
                if isThumbnails:
                    # Update thumbnails JSON with new URL
                    thumbnail_urls[thumb_type] = response
                    updated_thumbnails_json = json.dumps(thumbnail_urls)
                    model.get_or_update_thumbnails_and_expires_at_by_id(
                        project_id, updated_thumbnails_json, int(time.time()) + current_app.config["PRESIGNED_TTL_SECONDS"]
                    )
                else:
                    img_url, expires_at = model.get_or_update_img_url_and_expires_at_by_id(
                        project_id, response, int(time.time()) + current_app.config["PRESIGNED_TTL_SECONDS"]
                    )
                
                return response
            else:
                logging.info(f"Generated URL invalid: HTTP {get_resp.status_code}")
                get_resp.close()
                return None

        except Exception as e:
            logging.info(f"Error generating URL: {e}")
            return None

    @staticmethod
    def crop_image_in_memory(file_storage, size=720):
        try:
            # Directly open image from BytesIO object
            img_raw = Image.open(file_storage).convert("RGB")

            width, height = img_raw.size

            # Calculate cropping dimensions for center-crop
            if width > height:
                left = (width - height) // 2
                top = 0
                right = (width + height) // 2
                bottom = height
            else:
                left = 0
                top = (height - width) // 2
                right = width
                bottom = (height + width) // 2

            # Crop and resize
            img_cropped = img_raw.crop((left, top, right, bottom))
            img_resized = img_cropped.resize((size, size), Image.LANCZOS)

            # Save cropped image to BytesIO stream (in-memory)
            cropped_img_stream = BytesIO()
            img_resized.save(cropped_img_stream, format="JPEG")
            cropped_img_stream.seek(0)

            return cropped_img_stream

        except Exception as e:
            print(f"Error cropping image: {e}")
            raise
