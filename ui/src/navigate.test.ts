import { describe, expect, it } from "vitest";

import { NAVIGATE_MESSAGE_TYPE, TASKS_ROUTE, postNavigate } from "./navigate";

describe("asking the console to navigate", () => {
  it("posts the console's message shape to the pinned host origin only", () => {
    const sent: Array<[unknown, string]> = [];
    postNavigate({ parent: { postMessage: (message, origin) => sent.push([message, origin]) } }, TASKS_ROUTE, "https://console.example.test");
    expect(NAVIGATE_MESSAGE_TYPE).toBe("lattice:navigate");
    expect(sent).toEqual([[{ type: "lattice:navigate", route: "/tasks" }, "https://console.example.test"]]);
  });
});
