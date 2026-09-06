import unittest

from fastapi import HTTPException

from app.security import (
    MAX_IMAGE_BYTES,
    safe_image_content_type,
    sniff_image_type,
    validate_image_upload,
)


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 64


class SniffTests(unittest.TestCase):
    def test_detects_supported_formats(self) -> None:
        self.assertEqual(sniff_image_type(JPEG), "image/jpeg")
        self.assertEqual(sniff_image_type(PNG), "image/png")
        self.assertEqual(sniff_image_type(WEBP), "image/webp")

    def test_rejects_non_images(self) -> None:
        self.assertIsNone(sniff_image_type(b"<html><script>alert(1)</script>"))
        self.assertIsNone(sniff_image_type(b"GIF89a" + b"\x00" * 16))
        self.assertIsNone(sniff_image_type(b"<svg xmlns='http://www.w3.org/2000/svg'/>"))
        self.assertIsNone(sniff_image_type(b""))


class ValidateUploadTests(unittest.TestCase):
    def test_accepts_real_images_and_returns_server_decided_type(self) -> None:
        self.assertEqual(validate_image_upload(JPEG), "image/jpeg")
        self.assertEqual(validate_image_upload(PNG), "image/png")

    def test_rejects_html_disguised_as_an_image(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            validate_image_upload(b"<html><script>alert(1)</script></html>")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(caught.exception.detail, "UNSUPPORTED_IMAGE_TYPE")

    def test_rejects_empty_upload(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            validate_image_upload(b"")
        self.assertEqual(caught.exception.status_code, 400)

    def test_rejects_oversize_upload(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            validate_image_upload(JPEG + b"\x00" * MAX_IMAGE_BYTES)
        self.assertEqual(caught.exception.status_code, 413)

    def test_webp_is_sniffed_but_not_accepted_for_storage(self) -> None:
        # Sniffing knows the format; the allowlist is what decides storage.
        with self.assertRaises(HTTPException):
            validate_image_upload(WEBP)


class ServeTypeTests(unittest.TestCase):
    def test_only_allowlisted_types_are_served_back(self) -> None:
        self.assertEqual(safe_image_content_type("image/jpeg"), "image/jpeg")
        self.assertEqual(safe_image_content_type("image/png"), "image/png")

    def test_active_content_types_are_neutralised(self) -> None:
        for hostile in ("text/html", "image/svg+xml", "application/javascript", None):
            self.assertEqual(safe_image_content_type(hostile), "application/octet-stream")


if __name__ == "__main__":
    unittest.main()
