from collections.abc import Callable
from typing import TypeVar

from gangagent.providers.base import IAgentProvider, ProviderConfig

T = TypeVar("T", bound=IAgentProvider)

_REGISTRY: dict[str, type[IAgentProvider]] = {}


def register_provider(name: str) -> Callable[[type[T]], type[T]]:
    def decorator(cls: type[T]) -> type[T]:
        if name in _REGISTRY:
            raise ValueError(f"Provider '{name}' is already registered")
        _REGISTRY[name] = cls
        return cls

    return decorator


class ProviderRegistry:
    @staticmethod
    def names() -> list[str]:
        return sorted(_REGISTRY.keys())

    @staticmethod
    def get(name: str) -> type[IAgentProvider]:
        if name not in _REGISTRY:
            raise KeyError(
                f"Unknown provider '{name}'. Available: {ProviderRegistry.names()}"
            )
        return _REGISTRY[name]

    @staticmethod
    def create(name: str, config: ProviderConfig) -> IAgentProvider:
        cls = ProviderRegistry.get(name)
        return cls(config)  # type: ignore[call-arg]

    @staticmethod
    def discover() -> None:
        """Import implementations package so @register_provider decorators run."""
        import importlib
        import pkgutil

        from gangagent.providers import implementations

        for mod in pkgutil.iter_modules(implementations.__path__):
            importlib.import_module(f"{implementations.__name__}.{mod.name}")
