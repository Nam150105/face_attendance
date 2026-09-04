from __future__ import annotations

import os

import boto3
from botocore.exceptions import ClientError


class PrivateObjectStorage:
    def __init__(self) -> None:
        self.endpoint = os.environ["S3_ENDPOINT"]
        self.access_key = os.environ["S3_ACCESS_KEY"]
        self.secret_key = os.environ["S3_SECRET_KEY"]
        self.bucket = os.environ["S3_BUCKET"]
        self.client = boto3.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name="us-east-1",
        )

    def ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError as error:
            error_code = error.response.get("Error", {}).get("Code")
            if error_code not in {"404", "NoSuchBucket", "NotFound"}:
                raise
            self.client.create_bucket(Bucket=self.bucket)

    def put_private(self, object_key: str, content: bytes, content_type: str) -> str:
        self.ensure_bucket()
        self.client.put_object(
            Bucket=self.bucket,
            Key=object_key,
            Body=content,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return object_key
