import { expect, it } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";

import {
  isPortlessRoutePublished,
  isPublishedPortlessRoute,
  observePortlessRoute,
} from "./portless-observation";

async function listen(server: Server): Promise<void> {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  const closed = once(server, "close");
  server.close();
  await closed;
}

it("treats only routed and unavailable observations as published", () => {
  expect(isPortlessRoutePublished("routed")).toBe(true);
  expect(isPortlessRoutePublished("unavailable")).toBe(true);
  expect(isPortlessRoutePublished("unregistered")).toBe(false);
});

it("classifies the observable Portless route contract", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/unregistered") {
      response.statusCode = 404;
      response.end("No app registered for <strong>127.0.0.1</strong>");
      return;
    }
    if (request.url === "/unavailable") {
      response.statusCode = 502;
      response.end("Bad Gateway");
      return;
    }
    response.statusCode = request.url === "/other-404" ? 404 : 200;
    response.end("upstream response");
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Observation fixture did not expose a port");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    await expect(observePortlessRoute(`${origin}/unregistered`)).resolves.toBe(
      "unregistered"
    );
    await expect(observePortlessRoute(`${origin}/unavailable`)).resolves.toBe(
      "unavailable"
    );
    await expect(observePortlessRoute(`${origin}/routed`)).resolves.toBe(
      "routed"
    );
    await expect(observePortlessRoute(`${origin}/other-404`)).resolves.toBe(
      "routed"
    );
  } finally {
    await close(server);
  }

  await expect(observePortlessRoute(`${origin}/closed`)).resolves.toBe(
    "unavailable"
  );
});

it("classifies a route that does not respond within 500 ms as unavailable", async () => {
  const server = createServer(() => {
    // Leave the request open so the observer's timeout determines the result.
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Observation fixture did not expose a port");
  }
  const startedAt = performance.now();

  try {
    await expect(
      observePortlessRoute(`http://127.0.0.1:${address.port}/slow`)
    ).resolves.toBe("unavailable");
    expect(performance.now() - startedAt).toBeLessThan(1500);
  } finally {
    server.closeAllConnections();
    if (server.listening) {
      await close(server);
    }
  }
});

it("requires a responding proxy before treating unavailable as published", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/unavailable") {
      response.statusCode = 502;
      response.end("Bad Gateway");
      return;
    }
    if (request.url === "/unregistered" || request.url === "/probe") {
      response.statusCode = 404;
      response.end("No app registered for <strong>127.0.0.1</strong>");
      return;
    }
    if (request.url === "/hang") {
      return;
    }
    response.statusCode = 200;
    response.end("ok");
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Observation fixture did not expose a port");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    await expect(
      isPublishedPortlessRoute(`${origin}/routed`, `${origin}/probe`)
    ).resolves.toBe(true);
    await expect(
      isPublishedPortlessRoute(`${origin}/unregistered`, `${origin}/probe`)
    ).resolves.toBe(false);
    await expect(
      isPublishedPortlessRoute(`${origin}/unavailable`, `${origin}/probe`)
    ).resolves.toBe(true);
    await expect(
      isPublishedPortlessRoute(`${origin}/unavailable`, `${origin}/hang`)
    ).resolves.toBe(false);
  } finally {
    server.closeAllConnections();
    if (server.listening) {
      await close(server);
    }
  }

  await expect(
    isPublishedPortlessRoute(`${origin}/unavailable`, `${origin}/probe`)
  ).resolves.toBe(false);
});
