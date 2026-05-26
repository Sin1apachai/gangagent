from enum import StrEnum


class Capability(StrEnum):
    TEXT_GENERATION = "text_generation"
    STREAMING = "streaming"
    TOOL_USE = "tool_use"
    VISION = "vision"
    AUDIO_INPUT = "audio_input"
    THINKING_MODE = "thinking_mode"
    PROMPT_CACHING = "prompt_caching"
    STRUCTURED_OUTPUT = "structured_output"
    WEB_SEARCH = "web_search"
    CODE_EXECUTION = "code_execution"
    LONG_CONTEXT_200K = "long_context_200k+"
    EMBEDDINGS = "embeddings"
