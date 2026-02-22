import logging
from typing import AsyncIterator, Optional

import redis.asyncio as redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class RedisService:
    def __init__(self):
        settings = get_settings()
        self._redis_url = settings.REDIS_URL
        self._client: Optional[redis.Redis] = None

    async def _get_client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.from_url(
                self._redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            logger.info("Redis connection established")
        return self._client

    async def get(self, key: str) -> Optional[str]:
        try:
            client = await self._get_client()
            return await client.get(key)
        except Exception as e:
            logger.error(f"Redis GET error for key {key}: {e}")
            raise ConnectionError(f"Failed to get key {key}: {e}")

    async def set(self, key: str, value: str, expire: Optional[int] = None) -> None:
        try:
            client = await self._get_client()
            if expire is not None:
                await client.set(key, value, ex=expire)
            else:
                await client.set(key, value)
            logger.info(f"Redis SET key {key}")
        except Exception as e:
            logger.error(f"Redis SET error for key {key}: {e}")
            raise ConnectionError(f"Failed to set key {key}: {e}")

    async def delete(self, key: str) -> None:
        try:
            client = await self._get_client()
            await client.delete(key)
            logger.info(f"Redis DELETE key {key}")
        except Exception as e:
            logger.error(f"Redis DELETE error for key {key}: {e}")
            raise ConnectionError(f"Failed to delete key {key}: {e}")

    async def publish(self, channel: str, message: str) -> None:
        try:
            client = await self._get_client()
            await client.publish(channel, message)
            logger.info(f"Redis PUBLISH to channel {channel}")
        except Exception as e:
            logger.error(f"Redis PUBLISH error for channel {channel}: {e}")
            raise ConnectionError(f"Failed to publish to channel {channel}: {e}")

    async def subscribe(self, channel: str) -> AsyncIterator[str]:
        try:
            client = await self._get_client()
            pubsub = client.pubsub()
            await pubsub.subscribe(channel)
            logger.info(f"Redis SUBSCRIBE to channel {channel}")
            try:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        yield message["data"]
            finally:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
                logger.info(f"Redis UNSUBSCRIBE from channel {channel}")
        except Exception as e:
            logger.error(f"Redis SUBSCRIBE error for channel {channel}: {e}")
            raise ConnectionError(f"Failed to subscribe to channel {channel}: {e}")

    async def close(self) -> None:
        try:
            if self._client is not None:
                await self._client.close()
                logger.info("Redis connection closed")
                self._client = None
        except Exception as e:
            logger.warning(f"Error closing Redis connection: {e}")


redis_service = RedisService()
