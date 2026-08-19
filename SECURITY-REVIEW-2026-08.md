# Sidecar security review, 2026-08-19

Coverage note for the Go sidecar in this repo. Written as part of the org-wide
plugin trust-boundary review, whose main result was three findings in
lattice-plugin-sub-store. This repo produced none of that class, and it is the
only one of the four whose plan path already redacts credentials.

Reviewed against `origin/integration` at `16d7afd` (0.1.0-alpha.12).

## What was opened

`system-go/main.go` in full. That is the entire sidecar: one file, 150 lines,
no other non-test Go source in `system-go/`.

`manifest.json` in full, including both declared methods (`overview`, `plan`) on
the single `latticenet.wireguard/networks` interface.

`tools/pluginpack/pluginpack.go`, checked for archive path handling only. It is
byte-identical across all four plugin repos and already refuses `..`, absolute
paths, and `.` at line 125.

The test suite was run per-test. Everything passes except
`TestDescribeMatchesManifestContract`, which is a version drift and is covered
below.

## What was deliberately not opened

`ui/` was out of scope; a separate lane owned the plugin UIs and the bridge.

The server-side implementations of the two declared methods were not reviewed
here. Both are `backing: core`, so they live in lattice-server. Nothing in this
note says anything about whether their in-core implementations honour their
declared scopes, and the same applies to the key-handling claims this repo's
package documentation makes about core. That is a real gap in coverage of the
plugin's total surface and it belongs to a server review.

## The four questions

**Does any method declare a scope narrower than what it actually reaches?**

No, and structurally it cannot. Both declared methods are `backing: core`, and
the sidecar answers only the three lifecycle actions (`describe`, `health`,
`plan`). It serves neither scoped method, so there is no behaviour here for a
declared scope to be narrower than.

Checked rather than assumed: `TestManifestInterfacesAreServedAsDeclared` asserts
a core-backed method is *not* answered by the artifact and passes for both, and
`TestUnsupportedActionFailsClosed` passes, so anything outside the three
lifecycle actions is refused.

This is the class that produced all three sub-store findings, where a method
declared `substore:read` ran caller-supplied JavaScript with the host egress
broker attached. Nothing of that shape can exist here, because the sidecar runs
no caller-supplied anything.

**Does the sidecar perform its own network I/O or DNS?**

No. Zero call sites for any SDK host method (`rpc.call`, `http.do`,
`http.operator.do`, `kv.*`, `secret.*`, `notify.send`, `log.write`), no
`net/http` import, no `net.Dial`, no `net.Lookup*`. The handler is registered
with the host client parameter explicitly discarded (`main.go:53-57`), so it
holds no client to misuse.

**Does any credential or secret reach a log line, an error string, or a reply?**

No, and this repo is the one that gets it right. It is worth recording as the
pattern the other two should copy rather than as a non-event.

`renderPlan` (`main.go:116-135`) applies two filters in the correct order. Any
key whose lowercased name contains key, secret, token, password, passphrase or
credential is replaced with `[REDACTED]` (`isSensitivePlanField`,
`main.go:142-149`). Everything surviving that must additionally appear in the
`safePlanFields` allowlist (`main.go:34-47`) to be echoed at all, so an
unrecognised field is dropped rather than printed. Belt and braces, with the
allowlist as the load-bearing half, which is the right way round: a new field
carrying a new secret is excluded by default rather than needing the denylist to
have anticipated its name.

Two tests pin this, `TestDescribeNeverEchoesKeyMaterial` and
`TestPlanNeverEchoesKeyMaterial`, and both pass.

For contrast, and because it is the actionable part of this note: netguard
(`main.go:106-119`) and vpn-core (`main.go:94-105`) echo every plan payload key
and value with no filtering of either kind. Both are rated low for their own
reasons, but the asymmetry is unnecessary and this file is the reference
implementation for closing it.

The `describe` response is a static literal. Error strings are `fmt.Errorf` over
the action name and a JSON decode error, neither of which carries payload
content.

**Does anything reach a shell, a file path, or a generated config from an
operator-supplied or upstream-supplied string?**

No. There is no `os/exec`, no `exec.Command`, no file read or write, no
`filepath` use, and no `text/template` or `html/template` anywhere in the
sidecar. The plan text is string concatenation into a comment block that is
returned, not executed and not written anywhere.

The authoritative `wg0.conf` is rendered in core by `internal/wireguard` with
the private key left as a placeholder, bound to an approval by `plan_sha256`,
and applied by the node agent under a dead-man watchdog. A node's private key is
generated on-node and substituted at apply time from a local key file, so it
never reaches the server or this subprocess. None of that is in this repo; the
package documentation states it at `main.go:9-13`. I did not verify those claims
against the server, per the coverage gap noted above.

## Open, not fixed here

`TestDescribeMatchesManifestContract` fails on `origin/integration`. The
describe-time constant is `0.1.0-alpha.10` (`main.go:29`) while the signed
manifest is `0.1.0-alpha.12`, so the artifact reports a version two alphas
behind what the host enforces against. The guard that exists to catch this is
already present and already red, which makes it a release-process decision
rather than something to patch quietly. sub-store had the same drift with no
guard at all; that one has since been fixed and pinned.
