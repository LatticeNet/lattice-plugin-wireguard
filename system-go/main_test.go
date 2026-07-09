package main

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

type manifestContract struct {
	ID           string   `json:"id"`
	Version      string   `json:"version"`
	Type         string   `json:"type"`
	Capabilities []string `json:"capabilities"`
	Interfaces   []struct {
		Service string `json:"service"`
	} `json:"interfaces"`
}

func loadManifest(t *testing.T) manifestContract {
	t.Helper()
	raw, err := os.ReadFile("../manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest manifestContract
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	return manifest
}

func TestDescribeMatchesManifestContract(t *testing.T) {
	manifest := loadManifest(t)

	resp := handle(request{Action: "describe"})
	if !resp.OK {
		t.Fatalf("describe ok = false, error = %q", resp.Error)
	}
	var body struct {
		ID           string   `json:"id"`
		Version      string   `json:"version"`
		Capabilities []string `json:"capabilities"`
	}
	if err := json.Unmarshal(resp.Result, &body); err != nil {
		t.Fatal(err)
	}
	if body.ID != manifest.ID {
		t.Fatalf("id %q != manifest %q", body.ID, manifest.ID)
	}
	if body.Version != manifest.Version {
		t.Fatalf("version %q != manifest %q", body.Version, manifest.Version)
	}
	if !reflect.DeepEqual(body.Capabilities, manifest.Capabilities) {
		t.Fatalf("capabilities %v != manifest %v", body.Capabilities, manifest.Capabilities)
	}
	if manifest.Type != "system" {
		t.Fatalf("host-risk capabilities require type=system, got %q", manifest.Type)
	}
}

// This plugin deliberately declares no interfaces yet: the WireGuard networks
// read model (store + API) is a later slice, and a manifest must never declare
// a service the server cannot resolve — the gateway would fall through to this
// subprocess, which answers "unsupported action".
func TestManifestDeclaresNoUnresolvableInterfaces(t *testing.T) {
	manifest := loadManifest(t)
	if len(manifest.Interfaces) != 0 {
		t.Fatalf("interfaces must stay empty until the in-core services are registered, got %+v", manifest.Interfaces)
	}
	if resp := handle(request{Action: "call"}); resp.OK {
		t.Fatal("this subprocess must not answer gateway calls")
	}
}

func TestHealthAndPlan(t *testing.T) {
	if resp := handle(request{Action: "health"}); !resp.OK {
		t.Fatalf("health ok = false: %q", resp.Error)
	}
	resp := handle(request{Action: "plan", Payload: map[string]any{"network": "default", "node_id": "node-a"}})
	if !resp.OK {
		t.Fatalf("plan ok = false: %q", resp.Error)
	}
	if !strings.Contains(resp.Plan, "dry run") {
		t.Fatalf("plan must be labelled a dry run:\n%s", resp.Plan)
	}
	for _, want := range []string{"# network = default", "# node_id = node-a"} {
		if !strings.Contains(resp.Plan, want) {
			t.Fatalf("plan missing %q:\n%s", want, resp.Plan)
		}
	}
	first := handle(request{Action: "plan", Payload: map[string]any{"b": 2, "a": 1, "c": 3}}).Plan
	for i := 0; i < 20; i++ {
		if got := handle(request{Action: "plan", Payload: map[string]any{"c": 3, "a": 1, "b": 2}}).Plan; got != first {
			t.Fatalf("plan rendering is not deterministic:\n%s\n---\n%s", first, got)
		}
	}
}

func TestDescribeNeverEchoesKeyMaterial(t *testing.T) {
	resp := handle(request{Action: "describe"})
	for _, forbidden := range []string{"PrivateKey", "BEGIN OPENSSH", "wg genkey"} {
		if strings.Contains(string(resp.Result), forbidden) {
			t.Fatalf("describe leaked %q", forbidden)
		}
	}
}

// A private key must never be echoed by this subprocess, whatever it is handed.
func TestPlanNeverEchoesKeyMaterial(t *testing.T) {
	resp := handle(request{Action: "plan", Payload: map[string]any{
		"network":        "default",
		"private_key":    "super-secret-private-key",
		"preshared_key":  "super-secret-preshared-key",
		"api_token":      "super-secret-token",
		"unknown_field":  "operator-private-note",
		"interface_name": "wg0",
	}})
	if !resp.OK {
		t.Fatalf("plan ok = false: %q", resp.Error)
	}
	for _, forbidden := range []string{"super-secret-private-key", "super-secret-preshared-key", "super-secret-token", "operator-private-note"} {
		if strings.Contains(resp.Plan, forbidden) {
			t.Fatalf("plan leaked %q:\n%s", forbidden, resp.Plan)
		}
	}
	for _, want := range []string{"# private_key = [REDACTED]", "# preshared_key = [REDACTED]", "# api_token = [REDACTED]", "# interface_name = wg0"} {
		if !strings.Contains(resp.Plan, want) {
			t.Fatalf("plan missing %q:\n%s", want, resp.Plan)
		}
	}
	if strings.Contains(resp.Plan, "unknown_field") {
		t.Fatalf("plan must omit unknown payload fields:\n%s", resp.Plan)
	}
}

func TestUnsupportedActionFailsClosed(t *testing.T) {
	resp := handle(request{Action: "apply"})
	if resp.OK {
		t.Fatal("an unknown action must fail closed; this subprocess never applies anything")
	}
	if !strings.Contains(resp.Error, "unsupported action") {
		t.Fatalf("error = %q", resp.Error)
	}
}
