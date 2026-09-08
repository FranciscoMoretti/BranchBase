import { expect, test } from "bun:test";

import { serve } from "bun";

import { delay } from "../runtime/async-utils";
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
    { address: "[::1]:3000", command: "node", pid: 42, port: 3000 },
    { address: "127.0.0.1:5432", command: "postgres", pid: 7, port: 5432 },
  ]);
  expect(
    parseCwds("p42\nn/Users/test/Code/app\np7\nn/private/tmp/db").get(42)
  ).toBe("/Users/test/Code/app");
});
test("HTTP detection does not invent a loopback URL for a network-only listener", () => {
  const detector = new DetectedServices();
  expect(
    detector.webUrl({
      address: "192.168.1.5:3000",
      command: "server",
      cwd: "/repo",
      managed: false,
      pid: 42,
      port: 3000,
      resources: null,
      startedAt: null,
      url: null,
    })
  ).toBeNull();
});
test("HTTP detection requires a response, including non-2xx responses", async () => {
  const server = serve({
    fetch: () => new Response("Auth", { status: 401 }),
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const detector = new DetectedServices();
    const service = {
      address: `127.0.0.1:${server.port}`,
      command: "bun",
      cwd: "/repo",
      managed: false,
      pid: process.pid,
      port: server.port ?? 0,
      resources: null,
      startedAt: null,
      url: null,
    };
    expect(detector.webUrl(service)).toBeNull();
    const expectedUrl = `http://127.0.0.1:${server.port}`;
    const deadline = Date.now() + 1000;
    let detectedUrl = detector.webUrl(service);
    while (detectedUrl !== expectedUrl && Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- Service probe polling observes each attempt before waiting.
      await delay(25);
      detectedUrl = detector.webUrl(service);
    }
    expect(detectedUrl).toBe(expectedUrl);
  } finally {
    server.stop(true);
  }
});
test("HTTP detection retries a failed probe after the short negative cache", async () => {
  const reservation = serve({
    fetch: () => new Response("ready"),
    hostname: "127.0.0.1",
    port: 0,
  });
  const { port } = reservation;
  if (port === undefined) {
    throw new Error("Expected a reserved port.");
  }
  reservation.stop(true);
  const detector = new DetectedServices();
  const service = {
    address: `127.0.0.1:${port}`,
    command: "bun",
    cwd: "/repo",
    managed: false,
    pid: process.pid,
    port,
    resources: null,
    startedAt: null,
    url: null,
  };
  expect(detector.webUrl(service)).toBeNull();
  await delay(PROBE_TIMEOUT_MS);
  const server = serve({
    fetch: () => new Response("ready"),
    hostname: "127.0.0.1",
    port,
  });
  try {
    expect(detector.webUrl(service)).toBeNull();
    const expectedUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + NEGATIVE_PROBE_TTL_MS + PROBE_TIMEOUT_MS;
    let detectedUrl = detector.webUrl(service);
    while (detectedUrl !== expectedUrl && Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- Service probe polling observes each attempt before waiting.
      await delay(25);
      detectedUrl = detector.webUrl(service);
    }
    expect(detectedUrl).toBe(expectedUrl);
  } finally {
    server.stop(true);
  }
});
