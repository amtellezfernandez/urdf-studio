import test from "node:test";
import assert from "node:assert/strict";

import {
  isWslEnvironment,
  parseWslDefaultGatewayAddress,
  resolveWslHostRemoteAddresses,
} from "./wslOwnerProxy.js";

test("WSL host gateway is read from the default route", () => {
  const routeTable = [
    "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
    "eth0\t00000000\t01D216AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
  ].join("\n");

  assert.equal(parseWslDefaultGatewayAddress(routeTable), "172.22.210.1");
});

test("WSL host gateway resolver only runs inside WSL", () => {
  const readFileSync = (path) => {
    if (String(path).endsWith("osrelease")) {
      return "5.15.167.4-microsoft-standard-WSL2\n";
    }
    if (String(path).endsWith("route")) {
      return [
        "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
        "eth0\t00000000\t01D216AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
      ].join("\n");
    }
    throw new Error(`Unexpected read ${path}`);
  };

  assert.equal(isWslEnvironment({ readFileSync }), true);
  assert.deepEqual(
    [...resolveWslHostRemoteAddresses({ readFileSync })],
    ["172.22.210.1"],
  );
  assert.deepEqual(
    [
      ...resolveWslHostRemoteAddresses({
        readFileSync: () => "6.8.0-generic\n",
      }),
    ],
    [],
  );
});
