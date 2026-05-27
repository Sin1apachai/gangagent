"""Provider-neutral tool definition.

`Tool` mirrors the Anthropic shape (the leanest of the three), so converting to
Anthropic is a pass-through. OpenAI wraps it in `{"type": "function", ...}`;
Gemini uses `FunctionDeclaration`. See `tools/adapters.py`.

`input_schema` is a JSON Schema fragment — we keep it as a free-form dict so
callers can use any JSON Schema features their target vendor supports.
"""

from typing import Any

from pydantic import BaseModel, Field


class Tool(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "properties": {}}
    )
