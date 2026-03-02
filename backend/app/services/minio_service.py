import logging
from datetime import timedelta
from io import BytesIO
from typing import Optional

from minio import Minio
from minio.error import S3Error

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class MinIOService:
    def __init__(self):
        settings = get_settings()
        self._client: Optional[Minio] = None
        self._endpoint = settings.MINIO_ENDPOINT
        self._access_key = settings.MINIO_ACCESS_KEY
        self._secret_key = settings.MINIO_SECRET_KEY
        self._default_bucket = settings.MINIO_BUCKET
        self._secure = settings.MINIO_SECURE

    @property
    def client(self) -> Minio:
        if self._client is None:
            self._client = Minio(
                self._endpoint,
                access_key=self._access_key,
                secret_key=self._secret_key,
                secure=self._secure,
            )
        return self._client

    def ensure_bucket_exists(self, bucket: str) -> None:
        try:
            if not self.client.bucket_exists(bucket):
                self.client.make_bucket(bucket)
                logger.info(f"Created bucket: {bucket}")
        except S3Error as e:
            logger.error(f"Failed to ensure bucket exists: {e}")
            raise ConnectionError(f"Failed to create bucket {bucket}: {e}")

    def upload_file(self, bucket: str, object_name: str, file_content: bytes) -> str:
        try:
            self.ensure_bucket_exists(bucket)
            data = BytesIO(file_content)
            data_size = len(file_content)
            self.client.put_object(
                bucket,
                object_name,
                data,
                data_size,
            )
            logger.info(f"Uploaded {object_name} to bucket {bucket}")
            return object_name
        except S3Error as e:
            logger.error(f"Failed to upload file: {e}")
            raise ConnectionError(f"Failed to upload file: {e}")

    def upload_file_stream(
        self,
        bucket: str,
        object_name: str,
        stream: BytesIO,
        content_length: int,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload from a stream directly to MinIO, using multipart for files > 5 MB.

        MinIO's ``put_object`` automatically selects multipart upload when
        ``content_length >= part_size`` (default 5 MiB), so this avoids
        loading large files entirely into memory.
        """
        try:
            self.ensure_bucket_exists(bucket)
            self.client.put_object(
                bucket,
                object_name,
                stream,
                content_length,
                content_type=content_type,
            )
            logger.info(f"Stream-uploaded {object_name} ({content_length} B) to bucket {bucket}")
            return object_name
        except S3Error as e:
            logger.error(f"Failed to stream-upload file: {e}")
            raise ConnectionError(f"Failed to upload file: {e}")

    def download_file(self, bucket: str, blob_ref: str) -> bytes:
        try:
            response = self.client.get_object(bucket, blob_ref)
            data = response.read()
            response.close()
            response.release_conn()
            return data
        except S3Error as e:
            logger.error(f"Failed to download file: {e}")
            raise ConnectionError(f"Failed to download file: {e}")

    def delete_file(self, bucket: str, blob_ref: str) -> None:
        try:
            self.client.remove_object(bucket, blob_ref)
            logger.info(f"Deleted {blob_ref} from bucket {bucket}")
        except S3Error as e:
            logger.error(f"Failed to delete file: {e}")
            raise ConnectionError(f"Failed to delete file: {e}")

    def get_presigned_url(self, bucket: str, object_name: str, expires: int = 900) -> str:
        """Generate a presigned GET URL.

        If ``MINIO_PUBLIC_URL`` is configured, the internal service hostname
        in the URL is replaced with the public URL so the browser can reach it.
        """
        settings = get_settings()
        url = self.client.presigned_get_object(
            bucket,
            object_name,
            expires=timedelta(seconds=expires),
        )
        if settings.MINIO_PUBLIC_URL:
            scheme = "https" if self._secure else "http"
            internal = f"{scheme}://{self._endpoint}"
            url = url.replace(internal, settings.MINIO_PUBLIC_URL.rstrip("/"), 1)
        return url

    async def get_presigned_url_cached(
        self,
        bucket: str,
        object_name: str,
        redis_service: "any",  # type: ignore[type-arg]
    ) -> str:
        """Return a cached presigned URL, generating a new one on cache miss.

        URLs are cached in Redis for ``PRESIGNED_URL_EXPIRE_SECONDS - 60``
        seconds to ensure they remain valid when the browser fetches them.
        """
        settings = get_settings()
        expires = settings.PRESIGNED_URL_EXPIRE_SECONDS
        cache_key = f"presigned:{bucket}/{object_name}"
        try:
            cached = await redis_service.get(cache_key)
            if cached:
                return cached
        except Exception as exc:
            logger.warning("Redis cache miss (presigned URL): %s", exc)

        url = self.get_presigned_url(bucket, object_name, expires=expires)

        try:
            await redis_service.set(cache_key, url, expire=max(expires - 60, 60))
        except Exception as exc:
            logger.warning("Failed to cache presigned URL: %s", exc)

        return url


minio_service = MinIOService()
