import { spawn, spawnSync } from "node:child_process";

const TRAILING_SLASH = /\/$/;

export interface HostAdapter {
  openUrl: (url: string) => void;
  pickRepository: () => string | null;
}

const openMacOSUrl = (url: string): void => {
  const child = spawn("open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
};

const pickMacOSRepository = (): string | null => {
  const result = spawnSync(
    "osascript",
    [
      "-e",
      'POSIX path of (choose folder with prompt "Choose a Git repository")',
    ],
    { encoding: "utf-8" }
  );
  if (result.status !== 0) {
    if ((result.stderr ?? "").includes("User canceled")) {
      return null;
    }
    throw new Error((result.stderr || "Could not open folder picker").trim());
  }
  return result.stdout.trim().replace(TRAILING_SLASH, "");
};

export class MacOSHostAdapter implements HostAdapter {
  readonly openUrl = openMacOSUrl;
  readonly pickRepository = pickMacOSRepository;
}

const unsupportedHostAdapter = (): HostAdapter => ({
  openUrl: () => undefined,
  pickRepository: () => {
    throw new Error("The native repository picker currently requires macOS");
  },
});

export const currentHost = (): HostAdapter =>
  process.platform === "darwin"
    ? new MacOSHostAdapter()
    : unsupportedHostAdapter();
