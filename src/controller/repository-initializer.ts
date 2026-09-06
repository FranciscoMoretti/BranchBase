import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BranchBaseCommand,
  defaultBranchBaseSetupCommand,
  defaultBranchBaseStartCommand,
} from "../config/branchbase-command";
import type { WorktreeEnvConfig } from "../config/branchbase-config";

const FASTAPI_DEPENDENCY = /\bfastapi\b/i;
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

function gitRoot(repoPath: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repoPath,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || "Not a Git repository").trim());
  }
  return realpathSync(result.stdout.trim());
}

function projectDefaults(root: string): ProjectDefaults {
  if (COMPOSE_FILES.some((file) => existsSync(join(root, file)))) {
    return {
      label: "Docker Compose",
      start: {
        argv: ["docker", "compose", "up"],
      },
    };
  }
  if (existsSync(join(root, "package.json"))) {
    return {
      label: "Node.js",
      setup: defaultBranchBaseSetupCommand(),
      start: defaultBranchBaseStartCommand(),
    };
  }
  if (existsSync(join(root, "manage.py"))) {
    return { label: "Python · Django" };
  }
  if (existsSync(join(root, "pyproject.toml"))) {
    const content = readFileSync(join(root, "pyproject.toml"), "utf8");
    if (FASTAPI_DEPENDENCY.test(content)) {
      const usesUv = existsSync(join(root, "uv.lock"));
      return {
        label: "Python · FastAPI",
        ...(usesUv ? { setup: { argv: ["uv", "sync"] } } : {}),
      };
    }
    return { label: "Python" };
  }
  if (existsSync(join(root, "Cargo.toml"))) {
    return {
      label: "Rust · Cargo",
      setup: { argv: ["cargo", "fetch"] },
      start: { argv: ["cargo", "run"] },
    };
  }
  if (existsSync(join(root, "go.mod"))) {
    return {
      label: "Go",
      start: { argv: ["go", "run", "."] },
    };
  }
  return { label: "Unknown" };
}

export function planRepositoryInitialization(
  repoPath: string
): RepositoryInitializationPlan {
  const root = gitRoot(repoPath);
  const configPath = join(root, ".branchbase.json");
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
    version: 1,
    setup,
    appGroups: {
      Apps: {
        instances: { mode: "per-worktree" },
        start,
        stop: "process",
        env: { PORT: "{apps.App.port}" },
        apps: {
          App: {
            protocol: "http",
            readiness: "tcp",
          },
        },
      },
    },
  };
  return {
    config,
    configPath,
    detectedRuntime: defaults.label,
    detectedSetupCommand: defaults.setup?.argv.join(" ") ?? null,
    detectedStartCommand: defaults.start?.argv.join(" ") ?? null,
    repoPath: root,
  };
}

export function initializeRepository(
  repoPath: string
): RepositoryInitializationPlan {
  const plan = planRepositoryInitialization(repoPath);
  writeFileSync(plan.configPath, `${JSON.stringify(plan.config, null, 2)}\n`, {
    flag: "wx",
  });
  return plan;
}
