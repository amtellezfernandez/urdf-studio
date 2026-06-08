from __future__ import annotations

from pathlib import Path


def serial_port_aliases(port: str | Path) -> set[str]:
    normalized_port = str(port).strip()
    if not normalized_port:
        return set()

    aliases = {normalized_port}
    for prefix, alias_prefix in (("/dev/cu.", "/dev/tty."), ("/dev/tty.", "/dev/cu.")):
        if normalized_port.startswith(prefix):
            aliases.add(f"{alias_prefix}{normalized_port[len(prefix):]}")
            break
    return aliases


def serial_port_match_values(*ports: str | Path) -> set[str]:
    values: set[str] = set()
    for port in ports:
        values.update(serial_port_aliases(port))
    return values
