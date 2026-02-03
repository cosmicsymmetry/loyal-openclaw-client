#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");

const CONFIG_DIR = path.join(os.homedir(), ".loyal-openclaw");
const PRIVATE_KEY_PATH = path.join(CONFIG_DIR, "id_ed25519");
const PUBLIC_KEY_PATH = path.join(CONFIG_DIR, "id_ed25519.pub");
const CONFIG_FILE_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_SERVER_URL = "http://5.252.23.92:3000";
const DEFAULT_OPENCLAW_CONFIG =
  process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), ".openclaw", "openclaw.json");
const DEFAULT_OPENCLAW_ENV = path.join(os.homedir(), ".openclaw", ".env");

async function main() {
  if (typeof fetch !== "function") {
    console.error("This script requires Node.js 18+ (global fetch).");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    console.log("Loyal OpenClaw Setup");
    console.log("--------------------");
    console.log("");

    const serverUrl = normalizeUrl(DEFAULT_SERVER_URL);
    console.log(`Server: ${serverUrl}`);
    console.log("");

    const { publicKeyBase64, privateKey } = await loadOrCreateKeys();
    console.log("");
    console.log("Keys:");
    console.log(`  Private key: ${PRIVATE_KEY_PATH}`);
    console.log(`  Public key:  ${PUBLIC_KEY_PATH}`);
    console.log(`  Public key (base64): ${publicKeyBase64}`);

    const registerInfo = await registerUser(serverUrl, publicKeyBase64);
    console.log("");
    console.log(`OK: ${registerInfo.message}`);
    console.log(`  User ID: ${registerInfo.user.id}`);

    const wallet = (await ask(rl, "Solana wallet for deposits (leave blank to skip)", "")).trim();
    if (wallet) {
      const walletInfo = await signedJsonRequest(
        serverUrl,
        privateKey,
        publicKeyBase64,
        "POST",
        "/v1/wallet",
        { solana_wallet: wallet }
      );
      console.log(`OK: ${walletInfo.message}`);
    }

    const showDeposit = await confirm(rl, "Show deposit instructions now?", true);
    if (showDeposit) {
      try {
        const depositInfo = await signedJsonRequest(
          serverUrl,
          privateKey,
          publicKeyBase64,
          "GET",
          "/v1/deposit"
        );
        console.log("");
        console.log("Deposit Instructions");
        console.log("--------------------");
        console.log(`Network:  ${depositInfo.network}`);
        console.log(`Currency: ${depositInfo.currency}`);
        console.log(`Deposit:  ${depositInfo.deposit_wallet}`);
        if (depositInfo.your_wallet) {
          console.log(`From:     ${depositInfo.your_wallet}`);
        }
        console.log("");
        console.log(depositInfo.instructions);
        console.log("");
        console.log(`Note: ${depositInfo.note}`);
      } catch (error) {
        console.log("");
        console.log(`Deposit info unavailable: ${error.message}`);
      }
    }

    const createKey = await confirm(rl, "Create a Bearer API key now?", true);
    let apiKey = null;
    if (createKey) {
      const apiKeyInfo = await signedJsonRequest(
        serverUrl,
        privateKey,
        publicKeyBase64,
        "POST",
        "/v1/api-keys"
      );
      apiKey = apiKeyInfo.api_key;
      console.log("");
      console.log("API Key (Bearer):");
      console.log(apiKey);
      console.log("");
      console.log("Note: This key is only shown once.");
    }

    if (apiKey) {
      await saveLocalConfig({ server_url: serverUrl, api_key: apiKey });
      console.log(`Stored locally in ${CONFIG_FILE_PATH}`);
    } else {
      await saveLocalConfig({ server_url: serverUrl });
    }

    console.log("");
    const configureOpenclaw = await confirm(rl, "Configure OpenClaw now?", true);
    if (configureOpenclaw) {
      await configureOpenclawFlow(rl, serverUrl, apiKey);
    }

    console.log("");
    console.log("Setup complete.");
    console.log("Next steps:");
    console.log(`  1. Export OPENAI_API_BASE=${joinUrl(serverUrl, "/v1")}`);
    console.log("  2. Export OPENAI_API_KEY=<your_loyal_api_key>");
    console.log("  3. Use your OpenAI client or OpenClaw provider config");
  } catch (error) {
    console.error("");
    console.error("Setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

function normalizeUrl(url) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Server URL must include http:// or https:// (got "${url}")`);
  }
  return trimmed;
}

async function ask(rl, question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue || "";
}

async function confirm(rl, question, defaultYes) {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  const answer = (await rl.question(`${question}${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return ["y", "yes"].includes(answer);
}

async function loadOrCreateKeys() {
  await ensureDir(CONFIG_DIR, 0o700);

  const hasPrivate = fs.existsSync(PRIVATE_KEY_PATH);
  if (!hasPrivate) {
    return generateKeys();
  }

  const privateKeyPem = await fsp.readFile(PRIVATE_KEY_PATH, "utf-8");
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyBase64 = extractPublicKeyBase64(publicKey);

  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    await fsp.writeFile(PUBLIC_KEY_PATH, publicKeyBase64, { mode: 0o600 });
  }

  return { privateKey, publicKeyBase64 };
}

async function generateKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  await fsp.writeFile(PRIVATE_KEY_PATH, privateKeyPem, { mode: 0o600 });

  const publicKeyBase64 = extractPublicKeyBase64(publicKey);
  await fsp.writeFile(PUBLIC_KEY_PATH, publicKeyBase64, { mode: 0o600 });

  return { privateKey, publicKeyBase64 };
}

function extractPublicKeyBase64(publicKey) {
  const publicKeyBytes = publicKey.export({ type: "spki", format: "der" });
  return publicKeyBytes.slice(-32).toString("base64");
}

async function ensureDir(dirPath, mode) {
  await fsp.mkdir(dirPath, { recursive: true, mode });
}

async function registerUser(serverUrl, publicKeyBase64) {
  const { url } = buildEndpoint(serverUrl, "/v1/register");
  const response = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKeyBase64 }),
  });

  if (!response.ok) {
    throw new Error(`Registration failed: ${formatError(response.data)}`);
  }
  return response.data;
}

function signMessage(privateKey, message) {
  const signature = crypto.sign(null, Buffer.from(message, "utf-8"), privateKey);
  return signature.toString("base64");
}

async function signedJsonRequest(serverUrl, privateKey, publicKeyBase64, method, path, body) {
  const { url, signedPath } = buildEndpoint(serverUrl, path);
  const timestamp = Date.now().toString();
  const message = `${timestamp}:${method}:${signedPath}`;
  const signature = signMessage(privateKey, message);
  const authHeader = `Signature ${publicKeyBase64}:${timestamp}:${signature}`;

  const response = await fetchJson(url.toString(), {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(formatError(response.data));
  }

  return response.data;
}

function buildEndpoint(serverUrl, endpointPath) {
  const base = new URL(serverUrl);
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
  const endpoint = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  const signedPath = `${basePath}${endpoint}` || "/";
  const url = new URL(signedPath, base.origin).toString();
  return { url, signedPath };
}

function joinUrl(serverUrl, suffixPath) {
  const { url } = buildEndpoint(serverUrl, suffixPath);
  return url;
}

async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (error) {
    return { ok: false, data: `Network error: ${error.message}` };
  }

  const contentType = res.headers.get("content-type") || "";
  let data;
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
  } else {
    data = await res.text();
  }

  return { ok: res.ok, data };
}

function formatError(data) {
  if (!data) return "Unknown error";
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    return data.error?.message || data.message || JSON.stringify(data);
  }
  return String(data);
}

async function saveLocalConfig(update) {
  await ensureDir(CONFIG_DIR, 0o700);
  const current = readJsonFile(CONFIG_FILE_PATH) || {};
  const next = { ...current, ...update };
  await fsp.writeFile(CONFIG_FILE_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fsp.chmod(CONFIG_FILE_PATH, 0o600);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function configureOpenclawFlow(rl, serverUrl, apiKey) {
  const provider = (await ask(rl, "OpenClaw provider name", "loyal")).trim() || "loyal";
  const modelId = (await ask(rl, "Model ID to expose (required)", "")).trim();
  if (!modelId) {
    console.log("Skipping OpenClaw config (no model id provided).");
    return;
  }
  const modelName = (await ask(rl, "Model display name", modelId)).trim() || modelId;
  const baseUrl = normalizeUrl(await ask(rl, "Base URL for provider", joinUrl(serverUrl, "/v1")));
  const envVarName = (await ask(rl, "Env var name for API key", "LOYAL_API_KEY")).trim() || "LOYAL_API_KEY";

  if (!apiKey) {
    console.log("");
    console.log("No API key was created during setup. You'll need to set it later.");
  }

  const wantEnvFile = await confirm(rl, `Write ${envVarName} to ${DEFAULT_OPENCLAW_ENV}?`, true);
  if (wantEnvFile && apiKey) {
    await upsertEnvVar(DEFAULT_OPENCLAW_ENV, envVarName, apiKey);
    console.log(`OK: Wrote ${envVarName} to ${DEFAULT_OPENCLAW_ENV}`);
  }

  if (isOpenclawInstalled()) {
    console.log("Configuring OpenClaw via CLI...");
    await configureWithOpenclawCli(rl, provider, modelId, modelName, baseUrl, envVarName, apiKey);
    return;
  }

  console.log("OpenClaw CLI not found. Trying direct config file edit...");
  await configureWithConfigFile(rl, provider, modelId, modelName, baseUrl, envVarName, apiKey);
}

function isOpenclawInstalled() {
  const result = spawnSync("openclaw", ["config", "get", "gateway.port"], {
    stdio: "ignore",
  });
  if (result.error && result.error.code === "ENOENT") return false;
  return true;
}

async function configureWithOpenclawCli(
  rl,
  provider,
  modelId,
  modelName,
  baseUrl,
  envVarName,
  apiKey
) {
  const useInlineKey = apiKey
    ? await confirm(rl, "Store API key directly in OpenClaw config?", false)
    : false;
  const apiKeyValue = useInlineKey ? apiKey : `\${${envVarName}}`;

  await openclawConfigSet(`models.providers.${provider}.baseUrl`, baseUrl, false);
  await openclawConfigSet(`models.providers.${provider}.apiKey`, apiKeyValue, false);
  await openclawConfigSet(`models.providers.${provider}.api`, "openai-completions", false);
  await openclawConfigSet(
    `models.providers.${provider}.models`,
    JSON.stringify([{ id: modelId, name: modelName }]),
    true
  );

  const setPrimary = await confirm(
    rl,
    `Set agents.defaults.model.primary to ${provider}/${modelId}?`,
    true
  );
  if (setPrimary) {
    await openclawConfigSet(
      "agents.defaults.model.primary",
      `${provider}/${modelId}`,
      false
    );
  }

  const setAllowlist = await confirm(
    rl,
    `Add ${provider}/${modelId} to agents.defaults.models allowlist?`,
    false
  );
  if (setAllowlist) {
    await openclawConfigSet(
      `agents.defaults.models["${provider}/${modelId}"]`,
      "{}",
      true
    );
  }

  const setMode = await confirm(rl, "Set models.mode to \"merge\"?", true);
  if (setMode) {
    await openclawConfigSet("models.mode", "merge", false);
  }

  console.log("OK: OpenClaw config updated.");
  console.log("Restart the OpenClaw gateway to apply changes.");
}

async function openclawConfigSet(pathKey, value, asJson) {
  const args = ["config", "set", pathKey, value];
  if (asJson) args.push("--json");
  const result = spawnSync("openclaw", args, { encoding: "utf-8" });
  if (result.error) {
    throw new Error(`openclaw config set failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(`openclaw config set failed: ${stderr || stdout || "unknown error"}`);
  }
}

async function configureWithConfigFile(
  rl,
  provider,
  modelId,
  modelName,
  baseUrl,
  envVarName,
  apiKey
) {
  const configPath = (await ask(rl, "OpenClaw config path", DEFAULT_OPENCLAW_CONFIG)).trim();
  if (!configPath) {
    console.log("Skipping OpenClaw config (no config path provided).");
    return;
  }

  const existing = readJsonFile(configPath);
  if (!existing && fs.existsSync(configPath)) {
    console.log("Existing config is not valid JSON. Skipping automatic edits.");
    console.log("Use the OpenClaw CLI (openclaw config set) or edit manually.");
    return;
  }

  const config = existing || {};
  config.models = config.models || {};
  config.models.providers = config.models.providers || {};
  config.models.providers[provider] = config.models.providers[provider] || {};
  config.models.providers[provider].baseUrl = baseUrl;
  config.models.providers[provider].apiKey = `\${${envVarName}}`;
  config.models.providers[provider].api = "openai-completions";
  config.models.providers[provider].models = [{ id: modelId, name: modelName }];

  const setPrimary = await confirm(
    rl,
    `Set agents.defaults.model.primary to ${provider}/${modelId}?`,
    true
  );
  if (setPrimary) {
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.model = config.agents.defaults.model || {};
    config.agents.defaults.model.primary = `${provider}/${modelId}`;
  }

  const setAllowlist = await confirm(
    rl,
    `Add ${provider}/${modelId} to agents.defaults.models allowlist?`,
    false
  );
  if (setAllowlist) {
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.models = config.agents.defaults.models || {};
    config.agents.defaults.models[`${provider}/${modelId}`] = {};
  }

  config.models.mode = config.models.mode || "merge";

  await ensureDir(path.dirname(configPath), 0o700);
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fsp.chmod(configPath, 0o600);

  if (apiKey) {
    await upsertEnvVar(DEFAULT_OPENCLAW_ENV, envVarName, apiKey);
    console.log(`OK: Wrote ${envVarName} to ${DEFAULT_OPENCLAW_ENV}`);
  }

  console.log(`OK: Updated ${configPath}`);
  console.log("Restart the OpenClaw gateway to apply changes.");
}

async function upsertEnvVar(envPath, key, value) {
  const dir = path.dirname(envPath);
  await ensureDir(dir, 0o700);

  let lines = [];
  if (fs.existsSync(envPath)) {
    const raw = await fsp.readFile(envPath, "utf-8");
    lines = raw.split(/\r?\n/);
  }

  const escapedValue = String(value).replace(/"/g, '\\"');
  const newLine = `${key}="${escapedValue}"`;
  const matcher = new RegExp(`^\\s*(export\\s+)?${escapeRegExp(key)}=`);

  let updated = false;
  lines = lines.map((line) => {
    if (matcher.test(line)) {
      updated = true;
      return line.trimStart().startsWith("export ") ? `export ${newLine}` : newLine;
    }
    return line;
  });

  if (!updated) {
    lines.push(newLine);
  }

  await fsp.writeFile(envPath, lines.filter(Boolean).join("\n") + "\n", { mode: 0o600 });
  await fsp.chmod(envPath, 0o600);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();
