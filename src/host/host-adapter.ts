import { spawn, spawnSync } from "node:child_process";

const TRAILING_SLASH = /\/$/u;

export interface HostAdapter {
  openUrl: (url: string) => void;
  pickRepository: () => string | null;
}

export class MacOSHostAdapter implements HostAdapter {
  openUrl(url: string): void {
    const child = spawn("open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // Opening a URL is best effort.
    });
    child.unref();
  }

  pickRepository(): string | null {
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
  }
}

class UnsupportedHostAdapter implements HostAdapter {
  openUrl(): void {
    // The printed loopback URL remains usable.
  }

  pickRepository(): string | null {
    throw new Error("The native repository picker currently requires macOS");
  }
}

export const currentHost = (): HostAdapter =>
  process.platform === "darwin"
    ? new MacOSHostAdapter()
    : new UnsupportedHostAdapter();
