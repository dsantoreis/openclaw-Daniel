import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ensureMatrixCryptoRuntime, isNativeBinaryHealthy } from "./deps.js";

const logStub = vi.fn();

describe("ensureMatrixCryptoRuntime", () => {
  /**
   * Helper: create a resolveFn that also handles the isNativeBinaryHealthy
   * package.json lookup. When package.json is not resolved, the health check
   * returns true (package not installed), allowing require() to proceed.
   */
  function makeResolveFn(overrides?: Record<string, string>) {
    return (id: string) => {
      if (overrides?.[id] !== undefined) return overrides[id];
      // By default, fail to resolve the crypto package (signals "not installed")
      // so isNativeBinaryHealthy returns true and require() path is used.
      throw new Error(`Cannot resolve ${id}`);
    };
  }

  it("returns immediately when matrix SDK loads", async () => {
    const runCommand = vi.fn();
    const requireFn = vi.fn(() => ({}));

    await ensureMatrixCryptoRuntime({
      log: logStub,
      requireFn,
      runCommand,
      resolveFn: makeResolveFn(),
      nodeExecutable: "/usr/bin/node",
    });

    expect(requireFn).toHaveBeenCalledTimes(1);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("bootstraps missing crypto runtime and retries matrix SDK load", async () => {
    let bootstrapped = false;
    const requireFn = vi.fn(() => {
      if (!bootstrapped) {
        throw new Error(
          "Cannot find module '@matrix-org/matrix-sdk-crypto-nodejs-linux-x64-gnu' (required by matrix sdk)",
        );
      }
      return {};
    });
    const runCommand = vi.fn(async () => {
      bootstrapped = true;
      return { code: 0, stdout: "", stderr: "" };
    });

    await ensureMatrixCryptoRuntime({
      log: logStub,
      requireFn,
      runCommand,
      // resolveFn fails for package.json (package "not installed"),
      // but resolves download-lib.js for the bootstrap step
      resolveFn: makeResolveFn({
        "@matrix-org/matrix-sdk-crypto-nodejs/download-lib.js": "/tmp/download-lib.js",
      }),
      nodeExecutable: "/usr/bin/node",
    });

    expect(runCommand).toHaveBeenCalledWith({
      argv: ["/usr/bin/node", "/tmp/download-lib.js"],
      cwd: "/tmp",
      timeoutMs: 300_000,
      env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
    });
    expect(requireFn).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-crypto module errors without bootstrapping", async () => {
    const runCommand = vi.fn();
    const requireFn = vi.fn(() => {
      throw new Error("Cannot find module '@vector-im/matrix-bot-sdk'");
    });

    await expect(
      ensureMatrixCryptoRuntime({
        log: logStub,
        requireFn,
        runCommand,
        resolveFn: makeResolveFn(),
        nodeExecutable: "/usr/bin/node",
      }),
    ).rejects.toThrow("Cannot find module '@vector-im/matrix-bot-sdk'");

    expect(runCommand).not.toHaveBeenCalled();
    expect(requireFn).toHaveBeenCalledTimes(1);
  });
});

describe("isNativeBinaryHealthy", () => {
  it("returns true when package is not installed", () => {
    const resolveFn = vi.fn(() => {
      throw new Error("Cannot find module");
    });
    expect(isNativeBinaryHealthy(resolveFn)).toBe(true);
  });

  it("returns false when binary is truncated", () => {
    const tmpDir = fs.mkdtempSync("/tmp/deps-test-");
    const pkgJson = `${tmpDir}/package.json`;
    fs.writeFileSync(pkgJson, "{}");
    // Write a tiny file to simulate a truncated binary
    const platform = process.platform;
    const arch = process.arch;
    const nameMap: Record<string, Record<string, string>> = {
      darwin: { arm64: "darwin-arm64", x64: "darwin-x64" },
      linux: { x64: "linux-x64-gnu", arm64: "linux-arm64-gnu" },
      win32: { x64: "win32-x64-msvc", arm64: "win32-arm64-msvc" },
    };
    const suffix = nameMap[platform]?.[arch];
    if (!suffix) return; // skip on unsupported platform
    const binaryName = `matrix-sdk-crypto.${suffix}.node`;
    fs.writeFileSync(`${tmpDir}/${binaryName}`, Buffer.alloc(1024)); // 1KB = truncated

    const resolveFn = vi.fn((id: string) => {
      if (id.endsWith("package.json")) return pkgJson;
      throw new Error(`unexpected resolve: ${id}`);
    });

    expect(isNativeBinaryHealthy(resolveFn)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns true when binary has healthy size", () => {
    const tmpDir = fs.mkdtempSync("/tmp/deps-test-");
    const pkgJson = `${tmpDir}/package.json`;
    fs.writeFileSync(pkgJson, "{}");
    const platform = process.platform;
    const arch = process.arch;
    const nameMap: Record<string, Record<string, string>> = {
      darwin: { arm64: "darwin-arm64", x64: "darwin-x64" },
      linux: { x64: "linux-x64-gnu", arm64: "linux-arm64-gnu" },
      win32: { x64: "win32-x64-msvc", arm64: "win32-arm64-msvc" },
    };
    const suffix = nameMap[platform]?.[arch];
    if (!suffix) return;
    const binaryName = `matrix-sdk-crypto.${suffix}.node`;
    // Write a file larger than 5MB threshold
    fs.writeFileSync(`${tmpDir}/${binaryName}`, Buffer.alloc(6 * 1024 * 1024));

    const resolveFn = vi.fn((id: string) => {
      if (id.endsWith("package.json")) return pkgJson;
      throw new Error(`unexpected resolve: ${id}`);
    });

    expect(isNativeBinaryHealthy(resolveFn)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns false when binary file is missing entirely", () => {
    const tmpDir = fs.mkdtempSync("/tmp/deps-test-");
    const pkgJson = `${tmpDir}/package.json`;
    fs.writeFileSync(pkgJson, "{}");
    // Don't create any .node file

    const resolveFn = vi.fn((id: string) => {
      if (id.endsWith("package.json")) return pkgJson;
      throw new Error(`unexpected resolve: ${id}`);
    });

    expect(isNativeBinaryHealthy(resolveFn)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
