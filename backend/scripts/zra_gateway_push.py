from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib import error, request

from backend.services.zra_attestation import convert_zra_gateway_to_attestation


DEFAULT_API_BASE_URL = "http://127.0.0.1:8000"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a zRA gateway decision into a URDF Studio attestation status."
    )
    parser.add_argument("--robot-id", required=True, help="Robot identifier used by URDF Studio.")
    parser.add_argument(
        "--gateway-decision",
        required=True,
        help="Path to gateway-decision.json produced by zkp/device-attestation/gateway.js.",
    )
    parser.add_argument(
        "--api-base-url",
        default=DEFAULT_API_BASE_URL,
        help="URDF Studio backend base URL.",
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Print the converted payload response instead of POSTing it.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    gateway_decision = json.loads(Path(args.gateway_decision).read_text(encoding="utf-8"))
    payload = {
        "robot_id": args.robot_id,
        "gateway_decision": gateway_decision,
    }

    if args.print_only:
        converted = convert_zra_gateway_to_attestation(
            robot_id=args.robot_id,
            gateway_decision=gateway_decision,
        )
        print(json.dumps(converted.model_dump(mode="json"), indent=2))
        return 0

    endpoint = f"{args.api_base_url.rstrip('/')}/attestation/import/zra-gateway"
    http_request = request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(http_request) as response:
            print(response.read().decode("utf-8"))
            return 0
    except error.HTTPError as exc:
        print(exc.read().decode("utf-8"))
        return exc.code or 1


if __name__ == "__main__":
    raise SystemExit(main())
