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
const DEFAULT_PROVIDER = "Loyal";
const DEFAULT_ENV_VAR = "LOYAL_API_KEY";
const DEFAULT_OPENCLAW_CONFIG =
  process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), ".openclaw", "openclaw.json");
const DEFAULT_OPENCLAW_ENV = path.join(os.homedir(), ".openclaw", ".env");

async function main() {
  if (typeof fetch !== "function") {
    console.error("This script requires Node.js 18+ (global fetch).");
    process.exit(1);
  }

  const { rl, close } = createInteractiveInterface();

  try {
    console.log("Loyal OpenClaw Setup");
    console.log("--------------------");
    console.log("");
    console.log("This setup updates OpenClaw and Loyal config files (fully reversible).");
    console.log("It will create/update:");
    console.log(`  Loyal keys + config: ${CONFIG_DIR}`);
    console.log(
      `  OpenClaw config: ${DEFAULT_OPENCLAW_CONFIG} (or via the OpenClaw CLI, if installed)`
    );
    console.log(`  OpenClaw env: ${DEFAULT_OPENCLAW_ENV} (${DEFAULT_ENV_VAR})`);
    console.log(
      "Revert anytime by removing the Loyal provider entries and env var, or deleting the Loyal config directory."
    );
    console.log("");

    const localConfig = readJsonFile(CONFIG_FILE_PATH) || {};
    if (hasExistingSetup()) {
      console.log(`Detected existing Loyal setup in ${CONFIG_DIR}.`);
      const setupMode = await chooseSetupMode(rl);
      if (setupMode === "update-models") {
        const defaultServer = localConfig.server_url || DEFAULT_SERVER_URL;
        const serverUrl = normalizeUrl(await ask(rl, "Server URL", defaultServer));
        const apiKey = localConfig.api_key || null;
        const keys = await loadExistingKeys();
        const privateKey = keys?.privateKey || null;
        const publicKeyBase64 = keys?.publicKeyBase64 || null;
        console.log("");
        await updateOpenclawModelsFlow(serverUrl, apiKey, privateKey, publicKeyBase64);
        console.log("");
        console.log("Update complete.");
        return;
      }
      if (setupMode === "check-balance") {
        const serverUrl = normalizeUrl(localConfig.server_url || DEFAULT_SERVER_URL);
        const apiKey = localConfig.api_key || null;
        const keys = await loadExistingKeys();
        const privateKey = keys?.privateKey || null;
        const publicKeyBase64 = keys?.publicKeyBase64 || null;
        console.log("");
        await showBalanceAndDeposit(serverUrl, apiKey, privateKey, publicKeyBase64);
        console.log("");
        console.log("Done.");
        return;
      }
      console.log("");
    }

    const serverUrl = normalizeUrl(localConfig.server_url || DEFAULT_SERVER_URL);
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

    let apiKey = null;
    await showDepositInfo(serverUrl, apiKey, privateKey, publicKeyBase64);

    const apiKeyInfo = await signedJsonRequest(
      serverUrl,
      privateKey,
      publicKeyBase64,
      "POST",
      "/v1/api-keys"
    );
    apiKey = apiKeyInfo.api_key;
    console.log("");
    console.log("OK: Created Bearer API key.");
    console.log("API Key (Bearer):");
    console.log(apiKey);
    console.log("");
    console.log("Note: This key is only shown once.");

    if (apiKey) {
      await saveLocalConfig({ server_url: serverUrl, api_key: apiKey });
      console.log(`Stored locally in ${CONFIG_FILE_PATH}`);
    } else {
      await saveLocalConfig({ server_url: serverUrl });
    }

    console.log("");
    await configureOpenclawFlow(rl, serverUrl, apiKey, privateKey, publicKeyBase64);

    console.log("");
    console.log("Setup complete.");
  } catch (error) {
    console.error("");
    console.error("Setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    close();
  }
}

function normalizeUrl(url) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Server URL must include http:// or https:// (got "${url}")`);
  }
  return trimmed;
}

function hasExistingSetup() {
  return (
    fs.existsSync(CONFIG_FILE_PATH) ||
    fs.existsSync(PRIVATE_KEY_PATH) ||
    fs.existsSync(PUBLIC_KEY_PATH)
  );
}

async function ask(rl, question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue || "";
}

function createInteractiveInterface() {
  let input = stdin;
  let output = stdout;
  let needsClose = false;

  if (!stdin.isTTY && fs.existsSync("/dev/tty")) {
    try {
      input = fs.createReadStream("/dev/tty");
      output = fs.createWriteStream("/dev/tty");
      needsClose = true;
    } catch {
      input = stdin;
      output = stdout;
    }
  }

  const rl = readline.createInterface({ input, output });
  const close = () => {
    if (needsClose) {
      input.destroy();
      output.end();
    }
  };

  return { rl, close };
}

async function chooseSetupMode(rl) {
  console.log("Existing setup detected. What would you like to do?");
  console.log("  1. Configure everything from the beginning");
  console.log("  2. Update OpenClaw provider models list only");
  console.log("  3. Check balance and deposit address");
  while (true) {
    const answer = (await ask(rl, "Select 1, 2, or 3", "2")).trim();
    if (answer === "1") return "full";
    if (answer === "2") return "update-models";
    if (answer === "3") return "check-balance";
    console.log("Please enter 1, 2, or 3.");
  }
}

async function chooseModelId(rl, serverUrl, apiKey, privateKey, publicKeyBase64) {
  const models = await fetchAvailableModels(serverUrl, apiKey, privateKey, publicKeyBase64);

  if (!models.length) {
    console.log("No models were returned by the server.");
    return (await ask(rl, "Model ID to expose (leave blank to skip)", "")).trim();
  }

  console.log("");
  console.log("Available models:");
  models.forEach((model, index) => {
    const label = model.name && model.name !== model.id ? `${model.id} (${model.name})` : model.id;
    console.log(`  ${index + 1}. ${label}`);
  });

  while (true) {
    const answer = (await ask(rl, `Select model (1-${models.length}, Enter to skip)`, "")).trim();
    if (!answer) return "";
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= models.length) {
      return models[index - 1].id;
    }
    const matched = models.find((model) => model.id === answer);
    if (matched) return matched.id;
    console.log("Invalid selection. Try again.");
  }
}

async function fetchAvailableModels(serverUrl, apiKey, privateKey, publicKeyBase64) {
  const url = joinUrl(serverUrl, "/v1/models");
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  let response = await fetchJson(url, { method: "GET", headers });

  if (!response.ok && privateKey && publicKeyBase64) {
    try {
      const data = await signedJsonRequest(
        serverUrl,
        privateKey,
        publicKeyBase64,
        "GET",
        "/v1/models"
      );
      return normalizeModelList(data);
    } catch (error) {
      response = { ok: false, data: error.message };
    }
  }

  if (!response.ok) {
    console.log(`Unable to fetch models: ${formatError(response.data)}`);
    return [];
  }

  return normalizeModelList(response.data);
}

async function fetchBalanceInfo(serverUrl, apiKey, privateKey, publicKeyBase64) {
  if (privateKey && publicKeyBase64) {
    try {
      return await signedJsonRequest(serverUrl, privateKey, publicKeyBase64, "GET", "/v1/balance");
    } catch (error) {
      if (!apiKey) throw error;
    }
  }

  if (apiKey) {
    const url = joinUrl(serverUrl, "/v1/balance");
    const response = await fetchJson(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(formatError(response.data));
    }
    return response.data;
  }

  throw new Error("No authentication available for balance check.");
}

async function fetchDepositInfo(serverUrl, apiKey, privateKey, publicKeyBase64) {
  if (privateKey && publicKeyBase64) {
    try {
      return await signedJsonRequest(serverUrl, privateKey, publicKeyBase64, "GET", "/v1/deposit");
    } catch (error) {
      if (!apiKey) throw error;
    }
  }

  if (apiKey) {
    const url = joinUrl(serverUrl, "/v1/deposit");
    const response = await fetchJson(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(formatError(response.data));
    }
    return response.data;
  }

  throw new Error("No authentication available for deposit info.");
}

async function showBalanceInfo(serverUrl, apiKey, privateKey, publicKeyBase64) {
  try {
    const balanceInfo = await fetchBalanceInfo(serverUrl, apiKey, privateKey, publicKeyBase64);
    console.log("Balance");
    console.log("-------");
    const formatted = formatBalanceInfo(balanceInfo);
    if (formatted.lines) {
      formatted.lines.forEach((line) => console.log(line));
    } else {
      console.log(formatted.text);
    }
  } catch (error) {
    console.log("Balance");
    console.log("-------");
    console.log(`Balance unavailable: ${error.message}`);
  }
}

async function showDepositInfo(serverUrl, apiKey, privateKey, publicKeyBase64) {
  try {
    const depositInfo = await fetchDepositInfo(
      serverUrl,
      apiKey,
      privateKey,
      publicKeyBase64
    );
    console.log("");
    console.log("Deposit Instructions");
    console.log("--------------------");
    if (depositInfo.network) console.log(`Network:  ${depositInfo.network}`);
    if (depositInfo.currency) console.log(`Currency: ${depositInfo.currency}`);
    if (depositInfo.deposit_wallet || depositInfo.deposit_address || depositInfo.address) {
      console.log(
        `Deposit:  ${
          depositInfo.deposit_wallet || depositInfo.deposit_address || depositInfo.address
        }`
      );
    }
    if (depositInfo.instructions) {
      console.log("");
      console.log(depositInfo.instructions);
    }
    if (depositInfo.note) {
      console.log("");
      console.log(`Note: ${depositInfo.note}`);
    }

    const depositAddress =
      depositInfo.deposit_wallet || depositInfo.deposit_address || depositInfo.address || "";
    if (depositAddress) {
      console.log("");
      printQrCode(depositAddress);
    }
  } catch (error) {
    console.log("");
    console.log(`Deposit info unavailable: ${error.message}`);
  }
}

async function showBalanceAndDeposit(serverUrl, apiKey, privateKey, publicKeyBase64) {
  await showBalanceInfo(serverUrl, apiKey, privateKey, publicKeyBase64);
  await showDepositInfo(serverUrl, apiKey, privateKey, publicKeyBase64);
}

function formatBalanceInfo(balanceInfo) {
  if (balanceInfo == null) return { text: "Unknown" };
  if (typeof balanceInfo === "number" || typeof balanceInfo === "string") {
    return { text: String(balanceInfo) };
  }
  if (typeof balanceInfo === "object") {
    const amount =
      balanceInfo.balance ??
      balanceInfo.available_balance ??
      balanceInfo.available ??
      balanceInfo.amount ??
      balanceInfo.value;
    const currency = balanceInfo.currency || balanceInfo.unit || "";
    if (amount !== undefined && amount !== null) {
      const text = currency ? `${amount} ${currency}` : String(amount);
      return { text };
    }
    return { lines: JSON.stringify(balanceInfo, null, 2).split("\n") };
  }
  return { text: String(balanceInfo) };
}

function printQrCode(value) {
  if (!value) return;
  if (tryPrintQrencode(value)) return;
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    value
  )}`;
  console.log("QR Code (URL)");
  console.log(url);
}

function tryPrintQrencode(value) {
  const result = spawnSync(
    "qrencode",
    ["-t", "ANSIUTF8", "-o", "-", "-m", "1", value],
    { encoding: "utf-8" }
  );
  if (result.error || result.status !== 0) return false;
  if (!result.stdout) return false;
  console.log("QR Code");
  console.log("-------");
  console.log(result.stdout);
  return true;
}

function normalizeModelList(data) {
  if (!data) return [];
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
    ? data.models
    : [];

  return raw
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") return { id: item };
      if (typeof item === "object") {
        const id = item.id || item.model || item.name;
        if (!id) return null;
        return { id, name: item.name || item.display_name };
      }
      return null;
    })
    .filter(Boolean);
}

function buildProviderModels(models) {
  const seen = new Set();
  return models
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
    }))
    .filter((model) => {
      if (!model.id || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
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

async function loadExistingKeys() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) return null;
  try {
    const privateKeyPem = await fsp.readFile(PRIVATE_KEY_PATH, "utf-8");
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyBase64 = extractPublicKeyBase64(publicKey);
    return { privateKey, publicKeyBase64 };
  } catch (error) {
    console.log(`Warning: Failed to load existing keys: ${error.message}`);
    return null;
  }
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

async function configureOpenclawFlow(rl, serverUrl, apiKey, privateKey, publicKeyBase64) {
  const provider = DEFAULT_PROVIDER;
  const modelId = await chooseModelId(rl, serverUrl, apiKey, privateKey, publicKeyBase64);
  if (!modelId) {
    console.log("Skipping OpenClaw config (no model id provided).");
    return;
  }
  const modelName = "Loyal";
  const baseUrl = joinUrl(serverUrl, "/v1");
  const envVarName = DEFAULT_ENV_VAR;

  if (!apiKey) {
    console.log("");
    console.log(`No API key was created during setup. You'll need to set ${envVarName} later.`);
  } else {
    await upsertEnvVar(DEFAULT_OPENCLAW_ENV, envVarName, apiKey);
    console.log(`OK: Wrote ${envVarName} to ${DEFAULT_OPENCLAW_ENV}`);
  }

  if (isOpenclawInstalled()) {
    console.log("Configuring OpenClaw via CLI...");
    await configureWithOpenclawCli(provider, modelId, modelName, baseUrl, envVarName, apiKey);
    return;
  }

  console.log("OpenClaw CLI not found. Trying direct config file edit...");
  await configureWithConfigFile(provider, modelId, modelName, baseUrl, envVarName, apiKey);
}

async function updateOpenclawModelsFlow(serverUrl, apiKey, privateKey, publicKeyBase64) {
  const provider = DEFAULT_PROVIDER;
  const models = await fetchAvailableModels(serverUrl, apiKey, privateKey, publicKeyBase64);
  if (!models.length) {
    console.log("No models were returned by the server. Skipping OpenClaw updates.");
    return;
  }
  const providerModels = buildProviderModels(models);

  if (isOpenclawInstalled()) {
    console.log("Updating OpenClaw via CLI...");
    await openclawConfigSet(
      `models.providers.${provider}.models`,
      JSON.stringify(providerModels),
      true
    );
    console.log("OK: OpenClaw model list updated.");
    console.log("Restart the OpenClaw gateway to apply changes.");
    return;
  }

  console.log("OpenClaw CLI not found. Trying direct config file edit...");
  await updateModelsInConfigFile(provider, providerModels);
}

function isOpenclawInstalled() {
  const result = spawnSync("openclaw", ["config", "get", "gateway.port"], {
    stdio: "ignore",
  });
  if (result.error && result.error.code === "ENOENT") return false;
  return true;
}

async function configureWithOpenclawCli(
  provider,
  modelId,
  modelName,
  baseUrl,
  envVarName,
  apiKey
) {
  const apiKeyValue = apiKey || `\${${envVarName}}`;

  const providerConfig = {
    baseUrl,
    apiKey: apiKeyValue,
    api: "openai-completions",
    models: [{ id: modelId, name: modelName }],
  };

  await openclawConfigSet(
    `models.providers.${provider}`,
    JSON.stringify(providerConfig),
    true
  );
  if (apiKey) {
    console.log(`OK: Stored ${provider} API key directly in OpenClaw config.`);
  } else {
    console.log(`OK: Configured ${provider} API key to use ${envVarName}.`);
  }
  console.log(`OK: Set models.providers.${provider}.baseUrl to ${baseUrl}`);

  await openclawConfigSet(
    "agents.defaults.model.primary",
    `${provider}/${modelId}`,
    false
  );
  console.log(`OK: Set agents.defaults.model.primary to ${provider}/${modelId}`);

  await openclawConfigSet(
    `agents.defaults.models["${provider}/${modelId}"]`,
    "{}",
    true
  );
  console.log(`OK: Added ${provider}/${modelId} to agents.defaults.models allowlist`);

  await openclawConfigSet("models.mode", "merge", false);
  console.log('OK: Set models.mode to "merge"');

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
  provider,
  modelId,
  modelName,
  baseUrl,
  envVarName,
  apiKey
) {
  const configPath = DEFAULT_OPENCLAW_CONFIG;
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
  config.models.providers[provider].apiKey = apiKey || `\${${envVarName}}`;
  config.models.providers[provider].api = "openai-completions";
  config.models.providers[provider].models = [{ id: modelId, name: modelName }];

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = config.agents.defaults.model || {};
  config.agents.defaults.model.primary = `${provider}/${modelId}`;

  config.agents.defaults.models = config.agents.defaults.models || {};
  config.agents.defaults.models[`${provider}/${modelId}`] = {};

  config.models.mode = "merge";

  await ensureDir(path.dirname(configPath), 0o700);
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fsp.chmod(configPath, 0o600);

  console.log(`OK: Updated ${configPath}`);
  console.log(`OK: Set models.providers.${provider}.baseUrl to ${baseUrl}`);
  if (apiKey) {
    console.log(`OK: Stored ${provider} API key directly in ${configPath}`);
  } else {
    console.log(`OK: Configured ${provider} API key to use ${envVarName}.`);
  }
  console.log(`OK: Set agents.defaults.model.primary to ${provider}/${modelId}`);
  console.log(`OK: Added ${provider}/${modelId} to agents.defaults.models allowlist`);
  console.log('OK: Set models.mode to "merge"');
  console.log("Restart the OpenClaw gateway to apply changes.");
}

async function updateModelsInConfigFile(provider, providerModels) {
  const configPath = DEFAULT_OPENCLAW_CONFIG;
  if (!configPath) {
    console.log("Skipping OpenClaw config update (no config path provided).");
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
  config.models.providers[provider].models = providerModels;

  await ensureDir(path.dirname(configPath), 0o700);
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fsp.chmod(configPath, 0o600);

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
