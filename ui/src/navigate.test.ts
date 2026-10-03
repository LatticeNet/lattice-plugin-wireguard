import { describe, expect, it } from "vitest";

import { NAVIGATE_MESSAGE_TYPE, TASKS_ROUTE, consoleOriginFromHash, postNavigate } from "./navigate";

describe("asking the console to navigate", () => {
  it("posts the console's message shape to the pinned host origin only", () => {
    const sent: Array<[unknown, string]> = [];
    postNavigate({ parent: { postMessage: (message, origin) => sent.push([message, origin]) } }, TASKS_ROUTE, "https://console.example.test");
    expect(NAVIGATE_MESSAGE_TYPE).toBe("lattice:navigate");
    expect(sent).toEqual([[{ type: "lattice:navigate", route: "/tasks" }, "https://console.example.test"]]);
  });
});

describe("the console's origin from the frame fragment", () => {
  const NONCE = "nonce-0123456789abcdef";
  const HOST = "https://console.example.test";

  it("reads an exact http(s) origin beside a nonce, and nothing else", () => {
    expect(consoleOriginFromHash(`#lattice_nonce=${NONCE}&host_origin=${encodeURIComponent(`${HOST}/path`)}`)).toBe(HOST);
    expect(consoleOriginFromHash(`#lattice_nonce=short&host_origin=${encodeURIComponent(HOST)}`)).toBeNull();
    expect(consoleOriginFromHash(`#lattice_nonce=${NONCE}`)).toBeNull();
    expect(consoleOriginFromHash(`#lattice_nonce=${NONCE}&host_origin=javascript%3Aalert(1)`)).toBeNull();
    expect(consoleOriginFromHash(`#lattice_nonce=${NONCE}&host_origin=not%20a%20url`)).toBeNull();
  });
});
