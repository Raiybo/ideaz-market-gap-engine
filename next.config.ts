import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next regenerates AGENTS.md / CLAUDE.md on every build; we keep docs out of
  // the repo unless they are asked for.
  agentRules: false,
};

export default nextConfig;
