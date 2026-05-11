import { loadConfig } from "./config.ts";
import { createRunner } from "./runner.ts";

const { config, warnings } = loadConfig();
for (const warning of warnings) {
  console.warn(`[config] ${warning}`);
}

console.log(
  `[scraper] Watching ${config.targets.length} search URL(s) every ${
    config.scrapeIntervalMs / 1000
  }s.`,
);

const runner = createRunner(config);
if (process.argv.includes("--once")) {
  await runner.runOnce();
} else {
  await runner.start();
}
