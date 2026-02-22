import asyncio
import json
import logging
from typing import Callable, Optional

import aio_pika
from aio_pika import Message, DeliveryMode
from aio_pika.abc import AbstractRobustConnection, AbstractChannel

from app.core.config import get_settings

logger = logging.getLogger(__name__)

COMPILE_JOBS_QUEUE = "compile_jobs"

MAX_RETRIES = 3
RETRY_DELAY = 2


class RabbitMQService:
    def __init__(self):
        settings = get_settings()
        self._connection: Optional[AbstractRobustConnection] = None
        self._channel: Optional[AbstractChannel] = None
        self._rabbitmq_url = settings.RABBITMQ_URL

    async def _get_connection(self) -> AbstractRobustConnection:
        if self._connection is None or self._connection.is_closed:
            self._connection = await aio_pika.connect_robust(
                self._rabbitmq_url,
                timeout=30,
            )
            logger.info("RabbitMQ connection established")
        return self._connection

    async def _get_channel(self) -> AbstractChannel:
        if self._channel is None or self._channel.is_closed:
            connection = await self._get_connection()
            self._channel = await connection.channel()
            logger.info("RabbitMQ channel opened")
        return self._channel

    async def publish_message(self, queue: str, message: dict) -> None:
        for attempt in range(MAX_RETRIES):
            try:
                channel = await self._get_channel()
                await channel.declare_queue(queue, durable=True)

                message_body = json.dumps(message).encode()
                msg = Message(
                    body=message_body,
                    delivery_mode=DeliveryMode.PERSISTENT,
                    content_type="application/json",
                )

                await channel.default_exchange.publish(
                    msg,
                    routing_key=queue,
                )
                logger.info(f"Published message to queue {queue}")
                return
            except Exception as e:
                logger.warning(f"Publish attempt {attempt + 1} failed: {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY)
                    self._connection = None
                    self._channel = None
                else:
                    logger.error(f"Failed to publish message after {MAX_RETRIES} attempts")
                    raise ConnectionError(f"Failed to publish message: {e}")

    async def consume_messages(self, queue: str, callback: Callable[[dict], None]) -> None:
        for attempt in range(MAX_RETRIES):
            try:
                channel = await self._get_channel()
                await channel.set_qos(prefetch_count=1)

                queue_obj = await channel.declare_queue(queue, durable=True)

                async def process_message(msg: aio_pika.abc.AbstractIncomingMessage):
                    async with msg.process():
                        try:
                            body = json.loads(msg.body.decode())
                            callback(body)
                        except Exception as e:
                            logger.error(f"Error processing message: {e}")
                            raise

                await queue_obj.consume(process_message)
                logger.info(f"Started consuming from queue {queue}")
                return
            except Exception as e:
                logger.warning(f"Consume attempt {attempt + 1} failed: {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY)
                    self._connection = None
                    self._channel = None
                else:
                    logger.error(f"Failed to start consuming after {MAX_RETRIES} attempts")
                    raise ConnectionError(f"Failed to consume messages: {e}")

    async def close(self) -> None:
        try:
            if self._channel and not self._channel.is_closed:
                await self._channel.close()
                logger.info("RabbitMQ channel closed")
        except Exception as e:
            logger.warning(f"Error closing channel: {e}")

        try:
            if self._connection and not self._connection.is_closed:
                await self._connection.close()
                logger.info("RabbitMQ connection closed")
        except Exception as e:
            logger.warning(f"Error closing connection: {e}")

        self._channel = None
        self._connection = None


rabbitmq_service = RabbitMQService()
