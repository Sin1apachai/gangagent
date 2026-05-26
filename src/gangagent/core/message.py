from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class Role(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class Message(BaseModel):
    role: Role
    content: str
    name: str | None = None


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


class Response(BaseModel):
    content: str
    model: str
    provider: str
    finish_reason: Literal["stop", "length", "tool_use", "error"] = "stop"
    usage: Usage = Field(default_factory=Usage)
    raw: dict | None = None
