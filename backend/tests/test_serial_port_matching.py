from pathlib import Path

from backend.robot_gateway.serial_port_matching import (
    serial_port_aliases,
    serial_port_match_values,
)


def test_serial_port_aliases_include_macos_cu_and_tty_variants() -> None:
    assert serial_port_aliases("/dev/cu.usbmodem58760433331") == {
        "/dev/cu.usbmodem58760433331",
        "/dev/tty.usbmodem58760433331",
    }
    assert serial_port_aliases(Path("/dev/tty.usbserial-A50285BI")) == {
        "/dev/cu.usbserial-A50285BI",
        "/dev/tty.usbserial-A50285BI",
    }


def test_serial_port_aliases_keep_linux_and_wsl_paths_unchanged() -> None:
    assert serial_port_aliases("/dev/ttyACM0") == {"/dev/ttyACM0"}
    assert serial_port_aliases("/dev/ttyUSB0") == {"/dev/ttyUSB0"}
    assert serial_port_aliases("/dev/serial/by-id/usb-demo") == {
        "/dev/serial/by-id/usb-demo",
    }


def test_serial_port_match_values_keep_portable_paths_unchanged() -> None:
    assert serial_port_match_values("/dev/serial/by-id/usb-demo", "  ") == {
        "/dev/serial/by-id/usb-demo",
    }
