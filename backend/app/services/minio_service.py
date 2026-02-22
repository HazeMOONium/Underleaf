import logging
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


minio_service = MinIOService()
