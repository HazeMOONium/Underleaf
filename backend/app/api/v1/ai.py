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


async def _stream_deepseek(req: AIAssistRequest, settings):
    """Yield SSE chunks from the DeepSeek streaming API (OpenAI-compatible)."""
    try:
        from openai import AsyncOpenAI
    except ImportError:
        yield f"data: {json.dumps({'error': 'openai package not installed'})}\n\n"
        return

    client = AsyncOpenAI(
        api_key=settings.DEEPSEEK_API_KEY,
        base_url=settings.DEEPSEEK_BASE_URL,
    )
    user_message = _build_user_message(req)

    try:
        stream = await client.chat.completions.create(
            model=settings.DEEPSEEK_MODEL,
            max_tokens=MAX_TOKENS,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            stream=True,
        )

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield f"data: {json.dumps({'text': delta.content})}\n\n"
                await asyncio.sleep(0)

        yield f"data: {json.dumps({'done': True})}\n\n"

    except Exception as exc:
        error_str = str(exc)
        if "authentication" in error_str.lower() or "api key" in error_str.lower():
            yield f"data: {json.dumps({'error': 'Invalid DEEPSEEK_API_KEY. Check your .env file.'})}\n\n"
        elif "rate" in error_str.lower() and "limit" in error_str.lower():
            yield f"data: {json.dumps({'error': 'Rate limit exceeded. Please wait a moment.'})}\n\n"
        else:
            logger.error(f"AI assist error: {exc}")
            yield f"data: {json.dumps({'error': f'AI request failed: {error_str[:200]}'})}\n\n"


@router.post("/assist")
async def ai_assist(
    req: AIAssistRequest,
    current_user: User = Depends(get_current_user),
):
    settings = get_settings()
    if not settings.DEEPSEEK_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI feature not configured. Set DEEPSEEK_API_KEY in your environment.",
        )

    return StreamingResponse(
        _stream_deepseek(req, settings),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
