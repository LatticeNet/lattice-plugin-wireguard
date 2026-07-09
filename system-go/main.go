// Command lattice-plugin-wireguard is the official LatticeNet wireguard system
// plugin: WireGuard networks, topologies, and device peers for a Lattice fleet.
//
// It implements the Lattice system-plugin stdio contract: newline-delimited
// JSON {action,payload} on stdin, {ok,plan,message,result,error} on stdout. The
// Lattice system runner executes this artifact for the plugin lifecycle
// (describe/health/plan).
//
// The engine stays in lattice-server (ADR-001 D5/D6, design-13 D2): topology
// compilation, key handling, the approval flow, the dead-man watchdog, and the
// node task executor are core. This subprocess never mutates a host and never
// sees a private key — a node's key is generated on-node and substituted into
// the rendered config at apply time from a local key file.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

const (
	pluginID      = "latticenet.wireguard"
	pluginName    = "wireguard (VPN networks)"
	pluginVersion = "0.1.0-alpha.1"
)

var capabilities = []string{"node:read", "network:plan", "network:apply", "task:run"}

var safePlanFields = map[string]struct{}{
	"address":           {},
	"dns":               {},
	"endpoint":          {},
	"extra_allowed_ips": {},
	"interface_name":    {},
	"keepalive":         {},
	"listen_port":       {},
	"mtu":               {},
	"network":           {},
	"node_id":           {},
	"role":              {},
	"topology":          {},
}

type request struct {
	Action  string         `json:"action"`
	Payload map[string]any `json:"payload"`
}

type response struct {
	OK      bool            `json:"ok"`
	Plan    string          `json:"plan,omitempty"`
	Message string          `json:"message,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   string          `json:"error,omitempty"`
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			write(response{OK: false, Error: "invalid request: " + err.Error()})
			continue
		}
		write(handle(req))
	}
}

func handle(req request) response {
	switch req.Action {
	case "describe":
		body, _ := json.Marshal(map[string]any{
			"id":           pluginID,
			"name":         pluginName,
			"version":      pluginVersion,
			"capabilities": capabilities,
			"manages": []string{
				"named WireGuard networks with mesh, hub-and-spoke, or custom topology",
				"node memberships: roles, allocated addresses, MTU/DNS/keepalive overrides",
				"hub-advertised routes (LAN CIDRs, exit-node egress)",
				"external device peers with one-time config issuance",
				"adoption of existing on-box wg configs, read-only until adopted",
			},
			"engine": "lattice-server (core); this plugin is the official front",
			"safety": []string{
				"a peer's own address is always pinned to a host route",
				"only a hub's reviewed extra_allowed_ips widen a peer's AllowedIPs",
				"node private keys never reach the server or this subprocess",
				"apply is validate -> snapshot -> dead-man watchdog -> commit -> selfcheck",
			},
		})
		return response{OK: true, Result: body, Message: "wireguard capability surface"}
	case "health":
		return response{OK: true, Message: "wireguard plugin healthy"}
	case "plan":
		return response{OK: true, Plan: renderPlan(req.Payload), Message: "wireguard dry-run plan"}
	default:
		return response{OK: false, Error: fmt.Sprintf("unsupported action %q", req.Action)}
	}
}

// renderPlan summarizes, as an auditable dry-run, what a wireguard apply would
// do for the given payload. The real wg0.conf is rendered in core by
// internal/wireguard with the private key replaced by a placeholder, bound to
// an approval by plan_sha256, and applied by the node agent under a dead-man
// watchdog that restores the previous interface if the control plane goes away.
func renderPlan(payload map[string]any) string {
	lines := []string{"# wireguard plan (dry run — no host changes made here)"}
	keys := make([]string, 0, len(payload))
	for k := range payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		switch {
		case isSensitivePlanField(k):
			lines = append(lines, fmt.Sprintf("# %s = [REDACTED]", k))
		case isSafePlanField(k):
			lines = append(lines, fmt.Sprintf("# %s = %v", k, payload[k]))
		}
	}
	lines = append(lines,
		"# the authoritative wg0.conf is rendered in core (internal/wireguard) with the",
		"# private key left as a placeholder, then applied via plan->approve->apply.")
	return strings.Join(lines, "\n")
}

func isSafePlanField(key string) bool {
	_, ok := safePlanFields[strings.ToLower(key)]
	return ok
}

func isSensitivePlanField(key string) bool {
	lower := strings.ToLower(key)
	for _, marker := range []string{"key", "secret", "token", "password", "passphrase", "credential"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func write(resp response) { _ = json.NewEncoder(os.Stdout).Encode(resp) }
