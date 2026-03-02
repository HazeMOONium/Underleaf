import logging
import json
import sys
from contextvars import ContextVar
from typing import Any

request_id_var: ContextVar[str] = ContextVar("request_id", default="")


class JSONFormatter(logging.Formatter):
    # Fields set via logger.info(..., extra={...}) that should be top-level JSON keys
    _EXTRA_FIELDS = {"method", "path", "status", "duration", "request_id", "user_id"}

    def format(self, record: logging.LogRecord) -> str:
        log_data: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Prefer request_id from context var (set per-request); fall back to extra
        request_id = request_id_var.get() or getattr(record, "request_id", None)
        if request_id:
            log_data["request_id"] = request_id

        # Promote known extra fields to top-level JSON keys
        for field in self._EXTRA_FIELDS - {"request_id"}:
            val = getattr(record, field, None)
            if val is not None:
                log_data[field] = val

        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_data)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


setup_logging()
