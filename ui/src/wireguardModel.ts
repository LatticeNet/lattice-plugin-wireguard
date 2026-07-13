export const PRIVATE_KEY_PLACEHOLDER = "__LATTICE_WG_PRIVATE_KEY__";

export interface WireGuardNode {
  node_id: string;
  name: string;
  address?: string;
  public_key?: string;
  endpoint?: string;
  listen_port?: number;
  public_ip?: string;
  online: boolean;
  disabled?: boolean;
  last_seen?: string;
  configuration: "ready" | "partial" | "missing";
}

export function hostRoute(address?: string): string {
  if (!address) return "";
  if (address.includes("/")) return address;
  return address.includes(":") ? `${address}/128` : `${address}/32`;
}

export function redactedKey(key?: string): string {
  if (!key) return "not reported";
  if (key.length <= 16) return "reported";
  return `${key.slice(0, 8)}...${key.slice(-6)}`;
}

export function normalizedPort(value: string, fallback = 51820): number {
  if (!value.trim()) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Listen port must be an integer from 1 to 65535");
  return port;
}

export function previewConfig(target: WireGuardNode | undefined, peers: WireGuardNode[], port?: number): string {
  if (!target?.address) return "";
  const lines = [
    "[Interface]",
    `PrivateKey = ${PRIVATE_KEY_PLACEHOLDER}`,
    `Address = ${hostRoute(target.address)}`,
    `ListenPort = ${port || target.listen_port || 51820}`,
  ];
  for (const peer of peers.filter((value) => value.node_id !== target.node_id && value.address && value.public_key)) {
    lines.push("", "[Peer]", `# ${peer.name || peer.node_id}`, `PublicKey = ${peer.public_key}`, `AllowedIPs = ${hostRoute(peer.address)}`);
    if (peer.endpoint) lines.push(`Endpoint = ${peer.endpoint}`);
  }
  return lines.join("\n");
}

export function safeErrorMessage(value: unknown, fallback = "Request failed"): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}
