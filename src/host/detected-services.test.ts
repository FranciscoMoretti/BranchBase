import { expect, test } from "bun:test";
import { serve } from "bun";
import {
  DetectedServices,
  NEGATIVE_PROBE_TTL_MS,
  PROBE_TIMEOUT_MS,
  parseCwds,
  parseListeners,
} from "./detected-services";

test("listener parsing deduplicates IPv4/IPv6 and rejects invalid identities and ports", () => {
  expect(
    parseListeners(
      "p42\ncnode\nn*:3000\nn[::1]:3000\np7\ncpostgres\nn127.0.0.1:5432\npNaN\nn*:80\np2\nn*:99999\nn*:0"
    )
  ).toEqual([
    { pid: 42, command: "node", port: 3000, address: "[::1]:3000" },
    { pid: 7, command: "postgres", port: 5432, address: "127.0.0.1:5432" },
  ]);
  expect(
    parseCwds("p42\nn/Users/test/Code/app\np7\nn/private/tmp/db").get(42)
  ).toBe("/Users/test/Code/app");
});
test("HTTP detection does not invent a loopback URL for a network-only listener", () => {
  const detector = new DetectedServices();
  expect(
    detector.webUrl({
      pid: 42,
      command: "server",
      port: 3000,
      address: "192.168.1.5:3000",
      cwd: "/repo",
      startedAt: null,
      url: null,
      resources: null,
      managed: false,
    })
  ).toBeNull();
});
test("HTTP detection requires a response, including non-2xx responses", async () => {
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("Auth", { status: 401 }),
  });
  try {
    const detector = new DetectedServices();
    const service = {
      pid: process.pid,
      command: "bun",
      port: server.port ?? 0,
      address: `127.0.0.1:${server.port}`,
      cwd: "/repo",
      startedAt: null,
      url: null,
      resources: null,
      managed: false,
    };
    expect(detector.webUrl(service)).toBeNull();
    const expectedUrl = `http://127.0.0.1:${server.port}`;
    const deadline = Date.now() + 1000;
    let detectedUrl = detector.webUrl(service);
    while (detectedUrl !== expectedUrl && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      detectedUrl = detector.webUrl(service);
    }
    expect(detectedUrl).toBe(expectedUrl);
  } finally {
    server.stop(true);
  }
});
test("HTTP detection retries a failed probe after the short negative cache", async () => {
  const reservation = serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("ready"),
  });
  const port = reservation.port;
  if (port === undefined) {
    throw new Error("Expected a reserved port.");
  }
  reservation.stop(true);
  const detector = new DetectedServices();
  const service = {
    pid: process.pid,
    command: "bun",
    port,
    address: `127.0.0.1:${port}`,
    cwd: "/repo",
    startedAt: null,
    url: null,
    resources: null,
    managed: false,
  };
  expect(detector.webUrl(service)).toBeNull();
  const server = serve({
    port,
    hostname: "127.0.0.1",
    fetch: () => new Response("ready"),
  });
  try {
    expect(detector.webUrl(service)).toBeNull();
    const expectedUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + NEGATIVE_PROBE_TTL_MS + PROBE_TIMEOUT_MS;
    let detectedUrl = detector.webUrl(service);
    while (detectedUrl !== expectedUrl && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      detectedUrl = detector.webUrl(service);
    }
    expect(detectedUrl).toBe(expectedUrl);
  } finally {
    server.stop(true);
  }
});
