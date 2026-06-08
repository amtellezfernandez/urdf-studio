import test from "node:test";
import assert from "node:assert/strict";

import {
  createTeamSharingState,
  handleTeamSharingControlRequest,
  isLoopbackRemoteAddress,
  isTeamSharingControlPath,
  resolveTeamSharingRequestRemoteAddress,
  serializeTeamSharingState,
  shouldBlockTeamSharingRequest,
} from "./teamSharingGate.js";

const createTestResponse = () => ({
  body: "",
  headers: {},
  statusCode: 0,
  end(body = "") {
    this.body = body;
  },
  setHeader(name, value) {
    this.headers[name] = value;
  },
});

test("loopback remote address detection handles IPv4, IPv6, and mapped IPv4", () => {
  assert.equal(isLoopbackRemoteAddress("127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("::1"), true);
  assert.equal(isLoopbackRemoteAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("192.168.1.40"), false);
});

test("localhost proxy trust is scoped to loopback binds only", () => {
  const proxiedLoopbackAddress = resolveTeamSharingRequestRemoteAddress({
    remoteAddress: "172.22.210.1",
    webBindHost: "127.0.0.1",
  });
  const remotePrivateAddress = resolveTeamSharingRequestRemoteAddress({
    remoteAddress: "172.22.210.1",
    webBindHost: "0.0.0.0",
  });

  assert.equal(proxiedLoopbackAddress, "127.0.0.1");
  assert.equal(remotePrivateAddress, "172.22.210.1");
  assert.equal(
    shouldBlockTeamSharingRequest({
      enabled: false,
      remoteAddress: proxiedLoopbackAddress,
      requestUrl: "/",
    }),
    false,
  );
  assert.equal(
    shouldBlockTeamSharingRequest({
      enabled: false,
      remoteAddress: remotePrivateAddress,
      requestUrl: "/",
    }),
    true,
  );
});

test("WSL host gateway is trusted as the local owner for remote frontend binds", () => {
  const trustedOwnerRemoteAddresses = new Set(["172.22.210.1"]);
  const ownerAddress = resolveTeamSharingRequestRemoteAddress({
    remoteAddress: "::ffff:172.22.210.1",
    trustedOwnerRemoteAddresses,
    webBindHost: "0.0.0.0",
  });
  const remoteLanAddress = resolveTeamSharingRequestRemoteAddress({
    remoteAddress: "172.22.210.44",
    trustedOwnerRemoteAddresses,
    webBindHost: "0.0.0.0",
  });

  assert.equal(ownerAddress, "127.0.0.1");
  assert.equal(remoteLanAddress, "172.22.210.44");
  assert.equal(
    shouldBlockTeamSharingRequest({
      enabled: false,
      remoteAddress: ownerAddress,
      requestUrl: "/",
    }),
    false,
  );
  assert.equal(
    shouldBlockTeamSharingRequest({
      enabled: false,
      remoteAddress: remoteLanAddress,
      requestUrl: "/",
    }),
    true,
  );
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

test("team sharing control accepts a resolved WSL owner address", async () => {
  const response = createTestResponse();

  await handleTeamSharingControlRequest({
    request: {
      method: "GET",
      socket: { remoteAddress: "172.22.210.1" },
    },
    response,
    remoteAddress: "127.0.0.1",
    state: createTeamSharingState({
      enabled: false,
      localUrl: "http://127.0.0.1:5173",
      teamUrl: "http://172.22.210.70:5173",
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    available: true,
    enabled: false,
    localUrl: "http://127.0.0.1:5173",
    teamUrl: "http://172.22.210.70:5173",
  });
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
