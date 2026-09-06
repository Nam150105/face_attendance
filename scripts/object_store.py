"""Dump or load the private object bucket as a single tar.

Runs inside the api container, which already has boto3 and the S3 credentials.
The evidence bucket holds biometric images, so the tar it produces is as
sensitive as the database dump and must be stored with the same care.

    python object_store.py dump            # -> /tmp/objects.tar
    python object_store.py load [--bucket other]

The tar path is fixed rather than passed as an argument: Git Bash on Windows
rewrites arguments that look like absolute paths, which broke the backup script.
"""

from __future__ import annotations

import argparse
import io
import sys
import tarfile

sys.path.insert(0, "/app")

DEFAULT_TAR_PATH = "/tmp/objects.tar"

from app.services.storage import PrivateObjectStorage  # noqa: E402


def dump(path: str, bucket: str | None) -> int:
    storage = PrivateObjectStorage()
    target = bucket or storage.bucket
    count = 0
    with tarfile.open(path, "w") as archive:
        paginator = storage.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=target):
            for entry in page.get("Contents", []):
                body = storage.client.get_object(Bucket=target, Key=entry["Key"])["Body"].read()
                info = tarfile.TarInfo(name=entry["Key"])
                info.size = len(body)
                info.mtime = int(entry["LastModified"].timestamp())
                archive.addfile(info, io.BytesIO(body))
                count += 1
    print(f"dumped {count} objects from {target} to {path}")
    return count


def _ensure(storage: PrivateObjectStorage, target: str) -> None:
    """ensure_bucket() only knows the configured bucket; a restore may target
    another one, which is how a rehearsal avoids touching live evidence."""
    from botocore.exceptions import ClientError

    try:
        storage.client.head_bucket(Bucket=target)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in {"404", "NoSuchBucket", "NotFound"}:
            raise
        storage.client.create_bucket(Bucket=target)


def load(path: str, bucket: str | None) -> int:
    storage = PrivateObjectStorage()
    target = bucket or storage.bucket
    _ensure(storage, target)
    count = 0
    with tarfile.open(path, "r") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            extracted = archive.extractfile(member)
            if extracted is None:
                continue
            storage.client.put_object(
                Bucket=target,
                Key=member.name,
                Body=extracted.read(),
                ContentType="image/jpeg",
            )
            count += 1
    print(f"loaded {count} objects into {target} from {path}")
    return count


def count_objects(bucket: str | None) -> int:
    storage = PrivateObjectStorage()
    target = bucket or storage.bucket
    total = 0
    paginator = storage.client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=target):
        total += len(page.get("Contents", []))
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["dump", "load", "count"])
    parser.add_argument("--path", default=DEFAULT_TAR_PATH)
    parser.add_argument("--bucket", default=None, help="override the configured bucket")
    args = parser.parse_args()

    if args.command == "count":
        print(count_objects(args.bucket))
        return 0
    if args.command == "dump":
        dump(args.path, args.bucket)
    else:
        load(args.path, args.bucket)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
