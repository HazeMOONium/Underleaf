import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Literal

from app.core.config import get_settings
from app.api.v1.auth import get_current_user
from app.models.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])

SYSTEM_PROMPT = (
    "You are an expert LaTeX assistant integrated into a collaborative LaTeX editor called Underleaf. "
    "Your responses should be concise, accurate, and LaTeX-specific. "
    "When explaining errors, be clear and actionable. "
    "When suggesting LaTeX code, ensure it is syntactically correct and follows best practices."
)

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024


class AIAssistRequest(BaseModel):
    mode: Literal["explain_error", "suggest", "rewrite"]
    context: str  # error logs, file content, or selected text
    instruction: str = ""  # optional user instruction for rewrite mode


def _build_user_message(req: AIAssistRequest) -> str:
    if req.mode == "explain_error":
        return (
            "The following LaTeX compilation produced an error. "
            "Explain what went wrong in plain English and suggest how to fix it.\n\n"
            f"Compilation log:\n```\n{req.context[:4000]}\n```"
        )
    elif req.mode == "suggest":
        instruction = req.instruction or "Continue this LaTeX document naturally."
        return (
            f"{instruction}\n\n"
            f"Current document content (the cursor is at the end):\n"
            f"```latex\n{req.context[-3000:]}\n```\n\n"
            "Provide only the LaTeX snippet to insert, without any explanation."
        )
    else:  # rewrite
        instruction = req.instruction or "Improve the clarity and quality of this LaTeX text."
        return (
            f"{instruction}\n\n"
            f"LaTeX to rewrite:\n```latex\n{req.context[:3000]}\n```\n\n"
            "Provide only the rewritten LaTeX, without any explanation."
        )


async def _stream_anthropic(req: AIAssistRequest, api_key: str):
    """Yield SSE chunks from the Anthropic streaming API."""
    try:
        import anthropic
    except ImportError:
        yield f"data: {json.dumps({'error': 'anthropic package not installed'})}\n\n"
        return

    client = anthropic.AsyncAnthropic(api_key=api_key)
    user_message = _build_user_message(req)

    try:
        async with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            async for text_chunk in stream.text_stream:
                yield f"data: {json.dumps({'text': text_chunk})}\n\n"
                await asyncio.sleep(0)  # yield control to event loop

        yield f"data: {json.dumps({'done': True})}\n\n"

    except anthropic.AuthenticationError:
        yield f"data: {json.dumps({'error': 'Invalid ANTHROPIC_API_KEY. Check your .env file.'})}\n\n"
    except anthropic.RateLimitError:
        yield f"data: {json.dumps({'error': 'Rate limit exceeded. Please wait a moment.'})}\n\n"
    except Exception as exc:
        logger.error(f"AI assist error: {exc}")
        yield f"data: {json.dumps({'error': f'AI request failed: {str(exc)[:200]}'})}\n\n"


@router.post("/assist")
async def ai_assist(
    req: AIAssistRequest,
    current_user: User = Depends(get_current_user),
):
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI feature not configured. Set ANTHROPIC_API_KEY in your environment.",
        )

    return StreamingResponse(
        _stream_anthropic(req, settings.ANTHROPIC_API_KEY),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
