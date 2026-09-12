import {
  isBranchBaseCommandName,
  parseCommandInput,
  parseCommandResult,
} from "../../application/command-contract";

export class DaemonClient {
  private readonly origin: string;
  private readonly transport: (
    url: URL,
    init?: RequestInit
  ) => Promise<Response>;

  constructor(
    origin: string,
    transport: (url: URL, init?: RequestInit) => Promise<Response> = fetch
  ) {
    this.origin = origin;
    this.transport = transport;
  }

  async query(
    path: string,
    parameters: Record<string, string> = {}
  ): Promise<unknown> {
    const url = new URL(path, this.origin);
    url.search = new URLSearchParams(parameters).toString();
    return DaemonClient.read(
      await this.transport(url, { signal: AbortSignal.timeout(15_000) })
    );
  }

  async execute(command: string, input: unknown): Promise<unknown> {
    if (!isBranchBaseCommandName(command)) {
      throw new Error(`Unknown command: ${command}`);
    }
    const parsed = parseCommandInput(command, input);
    const session = await this.query("/api/session");
    if (
      !session ||
      typeof session !== "object" ||
      !("token" in session) ||
      typeof session.token !== "string"
    ) {
      throw new Error("Invalid daemon session");
    }
    // A command may outlive a transport connection. Never automatically replay it.
    const response = await this.transport(
      new URL(`/api/commands/${command}`, this.origin),
      {
        body: JSON.stringify(parsed),
        headers: {
          "content-type": "application/json",
          "x-branchbase-token": session.token,
        },
        method: "POST",
      }
    );
    return parseCommandResult(command, await DaemonClient.read(response));
  }

  private static async read(response: Response): Promise<unknown> {
    const body: unknown = await response.json();
    if (!response.ok) {
      const message =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `Daemon request failed (${response.status})`;
      throw new Error(message);
    }
    return body;
  }
}
