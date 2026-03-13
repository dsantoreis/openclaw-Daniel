import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPluginCommandWithTimeout, type RuntimeEnv } from "openclaw/plugin-sdk/matrix";

const MATRIX_SDK_PACKAGE = "@vector-im/matrix-bot-sdk";
const MATRIX_CRYPTO_PACKAGE = "@matrix-org/matrix-sdk-crypto-nodejs";
const MATRIX_CRYPTO_DOWNLOAD_HELPER = `${MATRIX_CRYPTO_PACKAGE}/download-lib.js`;

/**
 * Minimum expected size (bytes) for a valid native `.node` binary.
 * The real binaries are 10-25 MB depending on platform. A truncated download
 * (the root cause of #44656) is typically only 1-3 MB. Using 5 MB as the
 * threshold gives comfortable margin.
 */
const MIN_NATIVE_BINARY_BYTES = 5 * 1024 * 1024;

/**
 * Build the expected filename for the platform-specific native binary,
 * matching the naming convention used by @matrix-org/matrix-sdk-crypto-nodejs.
 */
function nativeBinaryName(): string | undefined {
  const p = os.platform();
  const a = os.arch();

  // Map Node.js platform/arch to the names used by the napi-rs generated index.js
  const platformMap: Record<string, Record<string, string>> = {
    darwin: { arm64: "darwin-arm64", x64: "darwin-x64" },
    linux: { x64: "linux-x64-gnu", arm64: "linux-arm64-gnu" },
    win32: { x64: "win32-x64-msvc", arm64: "win32-arm64-msvc" },
  };

  const archMap = platformMap[p];
  if (!archMap) return undefined;
  const suffix = archMap[a];
  if (!suffix) return undefined;
  return `matrix-sdk-crypto.${suffix}.node`;
}

function formatCommandError(result: { stderr: string; stdout: string }): string {
  const stderr = result.stderr.trim();
  if (stderr) {
    return stderr;
  }
  const stdout = result.stdout.trim();
  if (stdout) {
    return stdout;
  }
  return "unknown error";
}

function isMissingMatrixCryptoRuntimeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    message.includes("Cannot find module") &&
    message.includes("@matrix-org/matrix-sdk-crypto-nodejs-")
  );
}

export function isMatrixSdkAvailable(): boolean {
  try {
    const req = createRequire(import.meta.url);
    req.resolve(MATRIX_SDK_PACKAGE);
    return true;
  } catch {
    return false;
  }
}

function resolvePluginRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..");
}

/**
 * Check whether the platform-specific native binary exists and is not truncated.
 * A truncated binary causes SIGBUS when Node tries to mmap it, which kills the
 * process before any JS error handler can run (#44656).
 *
 * Returns `true` when the binary looks healthy (or when we cannot determine the
 * path, in which case we let the normal require() path handle it).
 */
export function isNativeBinaryHealthy(resolveFn?: (id: string) => string): boolean {
  const name = nativeBinaryName();
  if (!name) return true; // unknown platform, let require() decide

  const req = createRequire(import.meta.url);
  const resolve = resolveFn ?? ((id: string) => req.resolve(id));

  let cryptoPkgDir: string;
  try {
    const pkgJson = resolve(`${MATRIX_CRYPTO_PACKAGE}/package.json`);
    cryptoPkgDir = path.dirname(pkgJson);
  } catch {
    return true; // package not installed at all, let require() surface a clean error
  }

  const binaryPath = path.join(cryptoPkgDir, name);
  try {
    const stat = fs.statSync(binaryPath);
    return stat.size >= MIN_NATIVE_BINARY_BYTES;
  } catch {
    return false; // file missing entirely
  }
}

export async function ensureMatrixCryptoRuntime(
  params: {
    log?: (message: string) => void;
    requireFn?: (id: string) => unknown;
    resolveFn?: (id: string) => string;
    runCommand?: typeof runPluginCommandWithTimeout;
    nodeExecutable?: string;
  } = {},
): Promise<void> {
  const req = createRequire(import.meta.url);
  const requireFn = params.requireFn ?? ((id: string) => req(id));
  const resolveFn = params.resolveFn ?? ((id: string) => req.resolve(id));
  const runCommand = params.runCommand ?? runPluginCommandWithTimeout;
  const nodeExecutable = params.nodeExecutable ?? process.execPath;

  // Pre-flight: detect truncated native binary before require() can trigger
  // SIGBUS (#44656). If the binary exists but is too small, skip straight to
  // the download step instead of letting require() mmap a broken file.
  const binaryHealthy = isNativeBinaryHealthy(resolveFn);
  if (binaryHealthy) {
    try {
      requireFn(MATRIX_SDK_PACKAGE);
      return;
    } catch (err) {
      if (!isMissingMatrixCryptoRuntimeError(err)) {
        throw err;
      }
    }
  } else {
    params.log?.("matrix: native crypto binary appears truncated; re-downloading…");
  }

  const scriptPath = resolveFn(MATRIX_CRYPTO_DOWNLOAD_HELPER);
  if (binaryHealthy) {
    params.log?.("matrix: crypto runtime missing; downloading platform library…");
  }
  const result = await runCommand({
    argv: [nodeExecutable, scriptPath],
    cwd: path.dirname(scriptPath),
    timeoutMs: 300_000,
    env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
  if (result.code !== 0) {
    throw new Error(`Matrix crypto runtime bootstrap failed: ${formatCommandError(result)}`);
  }

  // Verify the binary is now healthy before attempting require()
  if (!isNativeBinaryHealthy(resolveFn)) {
    throw new Error(
      "Matrix crypto native binary is still truncated after re-download. " +
        "Try manually running: node download-lib.js " +
        "inside the @matrix-org/matrix-sdk-crypto-nodejs package directory.",
    );
  }

  try {
    requireFn(MATRIX_SDK_PACKAGE);
  } catch (err) {
    throw new Error(
      `Matrix crypto runtime remains unavailable after bootstrap: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function ensureMatrixSdkInstalled(params: {
  runtime: RuntimeEnv;
  confirm?: (message: string) => Promise<boolean>;
}): Promise<void> {
  if (isMatrixSdkAvailable()) {
    return;
  }
  const confirm = params.confirm;
  if (confirm) {
    const ok = await confirm("Matrix requires @vector-im/matrix-bot-sdk. Install now?");
    if (!ok) {
      throw new Error("Matrix requires @vector-im/matrix-bot-sdk (install dependencies first).");
    }
  }

  const root = resolvePluginRoot();
  const command = fs.existsSync(path.join(root, "pnpm-lock.yaml"))
    ? ["pnpm", "install"]
    : ["npm", "install", "--omit=dev", "--silent"];
  params.runtime.log?.(`matrix: installing dependencies via ${command[0]} (${root})…`);
  const result = await runPluginCommandWithTimeout({
    argv: command,
    cwd: root,
    timeoutMs: 300_000,
    env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || "Matrix dependency install failed.",
    );
  }
  if (!isMatrixSdkAvailable()) {
    throw new Error(
      "Matrix dependency install completed but @vector-im/matrix-bot-sdk is still missing.",
    );
  }
}
