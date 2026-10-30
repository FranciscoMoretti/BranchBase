import { defineConfig } from "blume";

export default defineConfig({
  agents: { llmsTxt: true },
  banner: "Development documentation · includes features from the next release",
  content: { root: "content" },
  description:
    "Run the apps your coding agents build side by side on your Mac. Manage their worktrees, services, and resource usage from one place.",
  github: { dir: "website", owner: "FranciscoMoretti", repo: "branchbase" },
  logo: { text: "BranchBase" },
  navigation: { sidebar: { display: "flat" } },
  theme: {
    accent: "teal",
    fonts: { body: "geist", display: "geist", mono: "geist-mono" },
  },
  title: "BranchBase Docs",
});
