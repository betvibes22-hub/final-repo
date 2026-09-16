// Runs once when the Next.js server process starts (requires
// experimental.instrumentationHook in next.config.js on Next 14).
// Used here to log a one-time Python/pip availability check to
// Render's runtime logs at boot, without needing any HTTP request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { execSync } = await import("child_process");
    const checks: Record<string, string> = {
      python3: "python3 --version",
      pip3: "pip3 --version",
      pip: "pip --version",
      which_python3: "which python3",
      node: "node --version",
    };
    const results: Record<string, string> = {};
    for (const [key, cmd] of Object.entries(checks)) {
      try {
        results[key] = execSync(cmd, { timeout: 5000 }).toString().trim();
      } catch (err) {
        results[key] = `ERROR: ${(err as Error).message.split("\n")[0]}`;
      }
    }
    console.log("PYTHON_DIAG_BOOT:", JSON.stringify(results));
  }
}
