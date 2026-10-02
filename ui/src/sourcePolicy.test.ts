/**
 * Two things the page must not do anywhere in its source, checked as a lint
 * over every module rather than as a claim about one file. These are absence
 * checks on purpose: what the page does is covered by the model tests and the
 * rendered checks, and a test that a string is present passes on dead code.
 * Both are cheap second checks. appReads.test.ts mounts the page and counts
 * what it sends the host, which also catches a poll or a height report
 * written under another name.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));

function sources(dir = root, prefix = ""): string[] {
  return readdirSync(`${dir}${prefix}`, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return sources(dir, `${path}/`);
    return /\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("wireguard source policy", () => {
  it("reports no height to the host", () => {
    // The host frame is a viewport it sizes itself and it ignores the
    // reported number; measuring the document on every body resize buys
    // nothing.
    for (const path of sources()) {
      const source = read(path);
      expect(source, path).not.toContain("ResizeObserver");
      expect(source, path).not.toMatch(/bridge\??\.resize\(/);
    }
  });

  it("reads data only when asked: the one interval is the age clock", () => {
    // A timed read re-sorts the fleet under the pointer. clock.ts ticks the
    // relative ages and reads nothing.
    const timed = sources().filter((path) => read(path).includes("setInterval("));
    expect(timed).toEqual(["clock.ts"]);
  });
});
