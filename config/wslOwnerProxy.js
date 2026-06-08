import fs from "node:fs";

const WSL_OWNER_PROXY_PARAMS = {
  osReleasePath: "/proc/sys/kernel/osrelease",
  routePath: "/proc/net/route",
  kernelMarkers: ["microsoft", "wsl"],
  defaultRouteDestinationHex: "00000000",
  ipv4GatewayHexPattern: /^[0-9a-fA-F]{8}$/,
  ipv4HexPairPattern: /../g,
  hexRadix: 16,
};

const readTextFile = (path, readFileSync) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

const parseLittleEndianIpv4Hex = (hex) => {
  if (!WSL_OWNER_PROXY_PARAMS.ipv4GatewayHexPattern.test(hex || "")) {
    return null;
  }
  return hex
    .match(WSL_OWNER_PROXY_PARAMS.ipv4HexPairPattern)
    .reverse()
    .map((part) => parseInt(part, WSL_OWNER_PROXY_PARAMS.hexRadix))
    .join(".");
};

export const isWslEnvironment = ({ readFileSync = fs.readFileSync } = {}) => {
  const osRelease = readTextFile(
    WSL_OWNER_PROXY_PARAMS.osReleasePath,
    readFileSync,
  ).toLowerCase();
  return WSL_OWNER_PROXY_PARAMS.kernelMarkers.some((marker) =>
    osRelease.includes(marker),
  );
};

export const parseWslDefaultGatewayAddress = (routeTableText) => {
  for (const line of String(routeTableText || "").split(/\r?\n/).slice(1)) {
    const [, destinationHex, gatewayHex] = line.trim().split(/\s+/);
    if (destinationHex !== WSL_OWNER_PROXY_PARAMS.defaultRouteDestinationHex) {
      continue;
    }
    const gatewayAddress = parseLittleEndianIpv4Hex(gatewayHex);
    if (gatewayAddress) {
      return gatewayAddress;
    }
  }
  return null;
};

export const resolveWslHostRemoteAddresses = ({
  readFileSync = fs.readFileSync,
} = {}) => {
  if (!isWslEnvironment({ readFileSync })) {
    return new Set();
  }
  const gatewayAddress = parseWslDefaultGatewayAddress(
    readTextFile(WSL_OWNER_PROXY_PARAMS.routePath, readFileSync),
  );
  return gatewayAddress ? new Set([gatewayAddress]) : new Set();
};
