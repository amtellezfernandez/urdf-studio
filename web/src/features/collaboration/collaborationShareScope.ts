import { COLLABORATION_SHARE_SCOPE_PARAMS } from "@/features/collaboration/collaborationShareScopeParams";

const SHARE_SCOPE_PARAMS = COLLABORATION_SHARE_SCOPE_PARAMS;
const TAILSCALE_CGNAT_FIRST_OCTET = SHARE_SCOPE_PARAMS.tailscaleCgnatFirstOctet;
const TAILSCALE_CGNAT_SECOND_OCTET_MIN = SHARE_SCOPE_PARAMS.tailscaleCgnatSecondOctetMin;
const TAILSCALE_CGNAT_SECOND_OCTET_MAX = SHARE_SCOPE_PARAMS.tailscaleCgnatSecondOctetMax;
const RFC1918_TEN_FIRST_OCTET = SHARE_SCOPE_PARAMS.rfc1918TenFirstOctet;
const RFC1918_ONE_SEVENTY_TWO_FIRST_OCTET = SHARE_SCOPE_PARAMS.rfc1918OneSeventyTwoFirstOctet;
const RFC1918_ONE_SEVENTY_TWO_SECOND_OCTET_MIN = SHARE_SCOPE_PARAMS.rfc1918OneSeventyTwoSecondOctetMin;
const RFC1918_ONE_SEVENTY_TWO_SECOND_OCTET_MAX = SHARE_SCOPE_PARAMS.rfc1918OneSeventyTwoSecondOctetMax;
const RFC1918_ONE_NINETY_TWO_FIRST_OCTET = SHARE_SCOPE_PARAMS.rfc1918OneNinetyTwoFirstOctet;
const RFC1918_ONE_NINETY_TWO_SECOND_OCTET = SHARE_SCOPE_PARAMS.rfc1918OneNinetyTwoSecondOctet;
const LOOPBACK_IPV4_FIRST_OCTET = SHARE_SCOPE_PARAMS.loopbackIpv4FirstOctet;
const IPV4_OCTET_COUNT = SHARE_SCOPE_PARAMS.ipv4OctetCount;
const IPV4_OCTET_MIN = SHARE_SCOPE_PARAMS.ipv4OctetMin;
const IPV4_OCTET_MAX = SHARE_SCOPE_PARAMS.ipv4OctetMax;

export type CollaborationShareScopeKind =
  | "local"
  | "lan"
  | "tailnet"
  | "public";

export type CollaborationShareScope = {
  kind: CollaborationShareScopeKind;
  badgeLabel: string;
  description: string;
  canEmail: boolean;
};

const stripIpv6Brackets = (host: string): string =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

const parseIpv4Octets = (host: string): number[] | null => {
  const parts = host.split(".");
  if (parts.length !== IPV4_OCTET_COUNT) return null;
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    return Number(part);
  });
  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= IPV4_OCTET_MIN && octet <= IPV4_OCTET_MAX,
  )
    ? octets
    : null;
};

const isLoopbackHost = (host: string): boolean => {
  const normalized = stripIpv6Brackets(host.trim().toLowerCase());
  const ipv4 = parseIpv4Octets(normalized);
  return (
    normalized === SHARE_SCOPE_PARAMS.localhostHostname ||
    normalized === SHARE_SCOPE_PARAMS.ipv6LoopbackHostname ||
    normalized === SHARE_SCOPE_PARAMS.allInterfacesIpv4Host ||
    Boolean(ipv4 && ipv4[0] === LOOPBACK_IPV4_FIRST_OCTET)
  );
};

const isTailnetHost = (host: string): boolean => {
  const normalized = stripIpv6Brackets(host.trim().toLowerCase());
  const ipv4 = parseIpv4Octets(normalized);
  if (normalized.endsWith(SHARE_SCOPE_PARAMS.tailnetDnsSuffix)) return true;
  return Boolean(
    ipv4 &&
      ipv4[0] === TAILSCALE_CGNAT_FIRST_OCTET &&
      ipv4[1] >= TAILSCALE_CGNAT_SECOND_OCTET_MIN &&
      ipv4[1] <= TAILSCALE_CGNAT_SECOND_OCTET_MAX,
  );
};

const isLanHost = (host: string): boolean => {
  const normalized = stripIpv6Brackets(host.trim().toLowerCase());
  const ipv4 = parseIpv4Octets(normalized);
  if (normalized.endsWith(SHARE_SCOPE_PARAMS.lanMdnsSuffix)) return true;
  return Boolean(
    ipv4 &&
      (ipv4[0] === RFC1918_TEN_FIRST_OCTET ||
        (ipv4[0] === RFC1918_ONE_SEVENTY_TWO_FIRST_OCTET &&
          ipv4[1] >= RFC1918_ONE_SEVENTY_TWO_SECOND_OCTET_MIN &&
          ipv4[1] <= RFC1918_ONE_SEVENTY_TWO_SECOND_OCTET_MAX) ||
        (ipv4[0] === RFC1918_ONE_NINETY_TWO_FIRST_OCTET &&
          ipv4[1] === RFC1918_ONE_NINETY_TWO_SECOND_OCTET)),
  );
};

export const resolveCollaborationShareScope = (rawUrl: string): CollaborationShareScope => {
  let host = "";
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return { ...SHARE_SCOPE_PARAMS.fallbackScope };
  }

  if (isLoopbackHost(host)) {
    return { ...SHARE_SCOPE_PARAMS.loopbackScope };
  }

  if (isTailnetHost(host)) {
    return { ...SHARE_SCOPE_PARAMS.tailnetScope };
  }

  if (isLanHost(host)) {
    return { ...SHARE_SCOPE_PARAMS.lanScope };
  }

  return { ...SHARE_SCOPE_PARAMS.publicScope };
};
