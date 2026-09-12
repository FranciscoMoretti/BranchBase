import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import pathModule from "node:path";

import {
  defaultBranchBaseSetupCommand,
  defaultBranchBaseStartCommand,
} from "./branchbase-command";
import type { BranchBaseCommand } from "./branchbase-command";
import type { WorktreeEnvConfig } from "./branchbase-config";

const FASTAPI_DEPENDENCY = /\bfastapi\b/iu;
const COMPOSE_FILES = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
] as const;
export interface RepositoryInitializationPlan {
  config: WorktreeEnvConfig;
  configPath: string;
  detectedRuntime: string;
  detectedSetupCommand: string | null;
  detectedStartCommand: string | null;
  repoPath: string;
}

interface ProjectDefaults {
  label: string;
  setup?: BranchBaseCommand;
  start?: BranchBaseCommand;
}

const gitRoot = (repoPath: string): string => {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || "Not a Git repository").trim());
  }
  return realpathSync(result.stdout.trim());
};

const projectDefaults = (root: string): ProjectDefaults => {
  if (COMPOSE_FILES.some((file) => existsSync(pathModule.join(root, file)))) {
    return {
      label: "Docker Compose",
      start: {
        argv: ["docker", "compose", "up"],
      },
    };
  }
  if (existsSync(pathModule.join(root, "package.json"))) {
    return {
      label: "Node.js",
      setup: defaultBranchBaseSetupCommand(),
      start: defaultBranchBaseStartCommand(),
    };
  }
  if (existsSync(pathModule.join(root, "manage.py"))) {
    return { label: "Python · Django" };
  }
  if (existsSync(pathModule.join(root, "pyproject.toml"))) {
    const content = readFileSync(
      pathModule.join(root, "pyproject.toml"),
      "utf-8"
    );
    if (FASTAPI_DEPENDENCY.test(content)) {
      const usesUv = existsSync(pathModule.join(root, "uv.lock"));
      return {
        label: "Python · FastAPI",
        ...(usesUv ? { setup: { argv: ["uv", "sync"] } } : {}),
      };
    }
    return { label: "Python" };
  }
  if (existsSync(pathModule.join(root, "Cargo.toml"))) {
    return {
      label: "Rust · Cargo",
      setup: { argv: ["cargo", "fetch"] },
      start: { argv: ["cargo", "run"] },
    };
  }
  if (existsSync(pathModule.join(root, "go.mod"))) {
    return {
      label: "Go",
      start: { argv: ["go", "run", "."] },
    };
  }
  return { label: "Unknown" };
};

export const planRepositoryInitialization = (
  repoPath: string
): RepositoryInitializationPlan => {
  const root = gitRoot(repoPath);
  const configPath = pathModule.join(root, ".branchbase.json");
  if (existsSync(configPath)) {
    throw new Error(
      `Worktree environment config already exists: ${configPath}`
    );
  }
  const defaults = projectDefaults(root);
  const setup = defaults.setup ?? defaultBranchBaseSetupCommand();
  const start = defaults.start ?? defaultBranchBaseStartCommand();
  const config: WorktreeEnvConfig = {
    $schema:
      "https://raw.githubusercontent.com/FranciscoMoretti/BranchBase/main/schema/branchbase.schema.json",
    appGroups: {
      Apps: {
        apps: {
          App: {
            protocol: "http",
            readiness: "tcp",
          },
        },
        env: { PORT: "{apps.App.port}" },
        instances: { mode: "per-worktree" },
        start,
        stop: "process",
      },
    },
    setup,
    version: 1,
  };
  return {
    config,
    configPath,
    detectedRuntime: defaults.label,
    detectedSetupCommand: defaults.setup?.argv.join(" ") ?? null,
    detectedStartCommand: defaults.start?.argv.join(" ") ?? null,
    repoPath: root,
  };
};

export const initializeRepository = (
  repoPath: string
): RepositoryInitializationPlan => {
  const plan = planRepositoryInitialization(repoPath);
  writeFileSync(plan.configPath, `${JSON.stringify(plan.config, null, 2)}\n`, {
    flag: "wx",
  });
  return plan;
};
