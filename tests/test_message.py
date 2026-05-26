from gangagent.core import Message, Role
from gangagent.providers.implementations.claude import ClaudeProvider


def test_to_anthropic_messages_separates_system() -> None:
    messages = [
        Message(role=Role.SYSTEM, content="You are concise."),
        Message(role=Role.USER, content="Hi"),
        Message(role=Role.ASSISTANT, content="Hello"),
        Message(role=Role.USER, content="Tell me a joke"),
    ]
    system, anthropic_messages = ClaudeProvider._to_anthropic_messages(messages)
    assert system == "You are concise."
    assert anthropic_messages == [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello"},
        {"role": "user", "content": "Tell me a joke"},
    ]
