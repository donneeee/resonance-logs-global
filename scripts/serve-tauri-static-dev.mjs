import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createServer, get } from "node:http";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const buildDir = resolve(rootDir, "build");
const parserDataDir = resolve(rootDir, "parser-data");
const localesDir = resolve(rootDir, "src", "lib", "locales");
const host = process.env.TAURI_DEV_HOST || "127.0.0.1";
const port = Number(process.env.TAURI_DEV_PORT || 1420);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

function runBuild() {
  const isWindows = process.platform === "win32";
  const command = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
  const args = isWindows ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
  const env = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192",
  };

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      shell: false,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`Static frontend build failed with exit code ${code}`));
      }
    });
  });
}

function isInside(childPath, parentPath) {
  const normalizedParent = parentPath.endsWith(sep) ? parentPath : `${parentPath}${sep}`;
  return childPath === parentPath || childPath.startsWith(normalizedParent);
}

function safeDecodePath(rawPath) {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return "/";
  }
}

function resolveRequestPath(urlPath) {
  const pathOnly = safeDecodePath(urlPath.split("?")[0] || "/").replace(/\\/g, "/");

  const roots = [
    { prefix: "/parser-data/", dir: parserDataDir, strip: "/parser-data/".length },
    { prefix: "/src/lib/locales/", dir: localesDir, strip: "/src/lib/locales/".length },
  ];

  for (const root of roots) {
    if (!pathOnly.startsWith(root.prefix)) continue;

    const relativePath = pathOnly.slice(root.strip);
    const resolved = resolve(root.dir, relativePath);
    if (isInside(resolved, root.dir) && existsSync(resolved) && statSync(resolved).isFile()) {
      return resolved;
    }

    return null;
  }

  const normalizedPath = pathOnly === "/" ? "/index.html" : pathOnly;
  const candidate = resolve(buildDir, normalizedPath.slice(1));

  if (isInside(candidate, buildDir) && existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return resolve(buildDir, "index.html");
}

function contentType(filePath) {
  const match = filePath.match(/\.[^.]+$/);
  return (match && contentTypes.get(match[0].toLowerCase())) || "application/octet-stream";
}

function requestText(pathname, timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };
    const request = get(
      {
        host,
        port,
        path: pathname,
        timeout: timeoutMs,
      },
      (response) => {
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 16_384) {
            response.destroy();
          }
        });
        response.on("end", () => {
          finish({ statusCode: response.statusCode ?? 0, body });
        });
        response.on("close", () => {
          finish({ statusCode: response.statusCode ?? 0, body });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy();
      finish(null);
    });
    request.on("error", () => finish(null));
  });
}

async function probeExistingStaticServer() {
  const marker = await requestText("/__tauri_static_dev_probe");
  if (marker?.statusCode === 200) {
    try {
      const payload = JSON.parse(marker.body);
      if (payload?.app === "resonance-logs-global-static-dev") {
        return "marker";
      }
    } catch {
      // Fall through to the legacy probe below.
    }
  }

  const localeProbe = await requestText(
    "/src/lib/locales/en/ui/overlay/skill-monitor/custom-panel.json",
  );
  if (
    localeProbe?.statusCode === 200 &&
    localeProbe.body.includes("customPanel.newFactor")
  ) {
    return "locale-probe";
  }

  return null;
}

function keepAliveForReusedServer(reason) {
  console.warn(
    `[tauri-static-dev] ${host}:${port} is already in use; reusing existing static dev server (${reason}).`,
  );
  console.warn(
    "[tauri-static-dev] If this looks stale, stop the old dev process or free port 1420, then rerun.",
  );
  setInterval(() => {}, 60 * 60 * 1000);
}

async function main() {
  await runBuild();

  const server = createServer((request, response) => {
    if ((request.url || "").split("?")[0] === "/__tauri_static_dev_probe") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          app: "resonance-logs-global-static-dev",
          rootDir,
          buildDir,
        }),
      );
      return;
    }

    const filePath = resolveRequestPath(request.url || "/");

    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  });

  server.on("error", async (error) => {
    if (error.code === "EADDRINUSE") {
      const reason = await probeExistingStaticServer();
      if (reason) {
        keepAliveForReusedServer(reason);
        return;
      }
    }

    console.error(`[tauri-static-dev] server failed: ${error.message}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`[tauri-static-dev] serving ${buildDir} at http://${host}:${port}/`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
