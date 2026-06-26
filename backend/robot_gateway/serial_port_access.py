from __future__ import annotations

from threading import Lock, RLock

# Cross-port lock retained for operations that must not overlap with any serial
# access on any port (e.g. device enumeration that probes candidate ports).
robot_gateway_serial_port_lock = RLock()

# Per-port serial locks. Each resolved serial port gets its own reentrant lock so
# that I/O on one port (e.g. an OpenArm left arm) does not serialize behind I/O on
# a different port (the right arm). A given port's bus is still serialized with
# itself, which the Feetech protocol requires.
_port_locks: dict[str, RLock] = {}
_port_locks_registry_lock = Lock()


def robot_gateway_port_serial_lock(port: str) -> RLock:
    """Return a stable reentrant lock dedicated to a single serial port.

    The same ``port`` string always yields the same lock, so concurrent readers
    of one port are serialized while readers of different ports run in parallel.
    """
    with _port_locks_registry_lock:
        lock = _port_locks.get(port)
        if lock is None:
            lock = RLock()
            _port_locks[port] = lock
        return lock
