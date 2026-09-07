import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

interface RequestMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}

type ScenarioHandler = (message: RequestMessage, requestNumber: number) => void;

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli fake\n");
  process.exit(0);
}

const scenario = process.env.BRANCHBASE_FAKE_CODEX_SCENARIO ?? "";
const input = createInterface({ input: process.stdin });
const recoveryMarker = process.env.BRANCHBASE_FAKE_CODEX_RECOVERY_MARKER;
let listRequestCount = 0;
let ready = false;

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const scenarios: Record<string, ScenarioHandler> = {
  changing(message, requestNumber) {
    setTimeout(() => {
      send({
        id: message.id,
        result: {
          data: [
            {
              createdAt: requestNumber,
              cwd: "/canonical/a",
              id: `task-request-${requestNumber}`,
              name: `Request ${requestNumber}`,
              updatedAt: requestNumber,
            },
          ],
          nextCursor: null,
        },
      });
    }, 20);
  },
  "endless-pages"(message, requestNumber) {
    if (requestNumber > 10) {
      return;
    }
    setTimeout(() => {
      send({
        id: message.id,
        result: { data: [], nextCursor: `cursor-${requestNumber}` },
      });
    }, 10);
  },
  exit() {
    process.exit(7);
  },
  "initialize-timeout-once"(message) {
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 1,
            cwd: "/canonical/a",
            id: "task-recovered",
            name: "Recovered",
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      },
    });
  },
  "malformed-row"(message) {
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 1,
            cwd: "/canonical/a",
            id: "",
            name: "Malformed",
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      },
    });
  },
  oversized(message) {
    send({
      id: message.id,
      result: {
        data: [],
        nextCursor: null,
        padding: "x".repeat(2000),
      },
    });
  },
  pagination(message) {
    const params = message.params ?? {};
    const safeRequest =
      params.archived === false &&
      Array.isArray(params.cwd) &&
      params.limit === 100 &&
      params.sortDirection === "desc" &&
      params.sortKey === "updated_at" &&
      params.useStateDbOnly === true &&
      !("sourceKinds" in params);
    if (!safeRequest) {
      send({ error: { code: -32_602 }, id: message.id });
      return;
    }
    const secondPage = params.cursor === "opaque-next-page";
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: secondPage ? 5 : 10,
            cwd: "/canonical/a",
            id: secondPage ? "task-second-page" : "task-first-page",
            name: secondPage ? "Second page" : "First page",
            updatedAt: secondPage ? 20 : 30,
          },
        ],
        nextCursor: secondPage ? null : "opaque-next-page",
      },
    });
  },
  "partial-eof-once"(message) {
    if (recoveryMarker && !existsSync(recoveryMarker)) {
      writeFileSync(recoveryMarker, "failed");
      process.stdout.write(`{"id":${message.id},"result":`);
      process.exit(0);
    }
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 1,
            cwd: "/canonical/a",
            id: "task-recovered",
            name: "Recovered",
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      },
    });
  },
  "repeated-cursor"(message, requestNumber) {
    if (requestNumber <= 2) {
      send({
        id: message.id,
        result: { data: [], nextCursor: "repeat" },
      });
    }
  },
  "single-page"(message) {
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 0,
            cwd: "/canonical/a",
            id: "task-a",
            name: null,
            preview: "must not cross the adapter seam",
            turns: [{ sensitive: true }],
            updatedAt: 2,
          },
          {
            createdAt: 1,
            cwd: "/canonical/b",
            id: "task-b",
            name: "Named task",
            updatedAt: 3,
          },
        ],
        nextCursor: null,
      },
    });
  },
  "transient-timeout"(message, requestNumber) {
    if (requestNumber <= 1) {
      return;
    }
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 1,
            cwd: "/canonical/a",
            id: "task-recovered",
            name: "Recovered",
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      },
    });
  },
  unsupported(message) {
    send({ error: { code: -32_602 }, id: message.id });
  },
  "wrong-cwd"(message) {
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 1,
            cwd: "/unrequested/private/path",
            id: "task-wrong-cwd",
            name: "Wrong cwd",
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      },
    });
  },
};

function handleInitialize(message: RequestMessage): void {
  const capabilities = message.params?.capabilities as
    | Record<string, unknown>
    | undefined;
  const clientInfo = message.params?.clientInfo as
    | Record<string, unknown>
    | undefined;
  if (
    capabilities?.experimentalApi !== false ||
    capabilities.requestAttestation !== false ||
    clientInfo?.name !== "branchbase"
  ) {
    send({ error: { code: -32_602 }, id: message.id });
    return;
  }
  if (
    scenario === "initialize-timeout-once" &&
    recoveryMarker &&
    !existsSync(recoveryMarker)
  ) {
    writeFileSync(recoveryMarker, "failed");
    return;
  }
  send({ id: message.id, result: {} });
}

function handleMessage(message: RequestMessage): void {
  if (message.method === "initialize") {
    handleInitialize(message);
    return;
  }
  if (message.method === "initialized") {
    ready = true;
    return;
  }
  if (message.method !== "thread/list") {
    return;
  }
  if (!ready) {
    send({ error: { code: -32_000 }, id: message.id });
    return;
  }
  listRequestCount += 1;
  scenarios[scenario]?.(message, listRequestCount);
}

input.on("line", (line) => {
  handleMessage(JSON.parse(line) as RequestMessage);
});
