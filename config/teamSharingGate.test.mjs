import test from "node:test";
import assert from "node:assert/strict";

import {
  createTeamSharingState,
  isLoopbackRemoteAddress,
  isTeamSharingControlPath,
  serializeTeamSharingState,
  shouldBlockTeamSharingRequest,
} from "./teamSharingGate.js";

test("loopback remote address detection handles IPv4, IPv6, and mapped IPv4", () => {
  assert.equal(isLoopbackRemoteAddress("127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("::1"), true);
  assert.equal(isLoopbackRemoteAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("192.168.1.40"), false);
});

test("team sharing control path is exact", () => {
  assert.equal(isTeamSharingControlPath("/__urdf_team_sharing"), true);
  assert.equal(isTeamSharingControlPath("/__urdf_team_sharing?cache=off"), true);
  assert.equal(isTeamSharingControlPath("/__urdf_team_sharing/extra"), false);
});

test("team sharing gate blocks remote app requests until enabled", () => {
  assert.equal(
    shouldBlockTeamSharingRequest({
      enabled: false,
      remoteAddress: "192.168.1.40",
      requestUrl: "/",
    }),
    true,
  );
  assert.equal(
    shouldBlockTeamSharingRequest({
      enabled: true,
      remoteAddress: "192.168.1.40",
      requestUrl: "/",
    }),
    false,
  );
  assert.equal(
    shouldBlockTeamSharingRequest({
      enabled: false,
      remoteAddress: "127.0.0.1",
      requestUrl: "/",
    }),
    false,
  );
});

test("team sharing state serializes only public status fields", () => {
  assert.deepEqual(
    serializeTeamSharingState(
      createTeamSharingState({
        enabled: true,
        localUrl: "http://localhost:5173",
        teamUrl: "http://192.168.1.40:5173",
      }),
    ),
    {
      available: true,
      enabled: true,
      localUrl: "http://localhost:5173",
      teamUrl: "http://192.168.1.40:5173",
    },
  );
});
