# Loyal OpenClaw Client

Private OpenClaw integration that runs in a Trusted Execution Environment (TEE).

This repo provides a public, Node-only setup script for Loyal-OpenClaw users. It is designed for fully private usage: keys and sensitive data are isolated inside a TEE, so only the enclave can access them.

## Why use this integration

- **Fully private by design.** Secrets are confined to a hardware-backed TEE, not exposed to the host OS or other processes.
- **Confidential computing.** Workloads run in an isolated enclave that protects data in use.
- **Simple setup.** One command to register keys, create an API key, and configure OpenClaw.

## What is a TEE

A Trusted Execution Environment (TEE) is a hardware-backed, isolated area of a CPU that runs code and stores data in a protected enclave. The isolation prevents the host operating system, hypervisor, and other applications from reading or tampering with what runs inside the TEE.

In practice, a TEE provides:

- **Isolation.** Code and data are separated from the rest of the machine.
- **Confidentiality.** Data remains encrypted and inaccessible outside the enclave.
- **Integrity.** The enclave helps ensure code and data are not modified by external software.

## How it works

1. You run the setup script locally.
2. A keypair is generated or reused and your public key is registered.
3. The Loyal-OpenClaw service runs inside a TEE, keeping private data accessible only within the enclave.
4. You receive deposit instructions and a one-time API key for OpenClaw configuration.

## Pricing

- **Input tokens:** $0.11 per 1M tokens
- **Output tokens:** $0.55 per 1M tokens

## Deposits

When you run the setup script, you will be given a Solana (Sol) deposit address. Currently, only USDC is accepted for deposits.

## One-liner setup (recommended)

Requires Node.js 18+.

```bash
curl -fsSL https://raw.githubusercontent.com/cosmicsymmetry/loyal-openclaw-client/main/loyal-openclaw-setup.js | node
```

The setup uses the hosted Loyal-OpenClaw server by default (no URL needed).

## What it does

- Generates or reuses an Ed25519 keypair in `~/.loyal-openclaw/`
- Registers your public key with the server
- Shows deposit instructions
- Prints a QR code for the deposit address
- Creates a Bearer API key (shown once)
- Configures your OpenClaw provider config (and `~/.openclaw/.env`)

## Files written

```
~/.loyal-openclaw/
├── id_ed25519      # Private key (PEM)
├── id_ed25519.pub  # Public key (base64)
└── config.json     # server_url
```

```
~/.openclaw/
├── openclaw.json   # Provider config updates (includes API key if OpenClaw CLI isn't used)
└── .env            # LOYAL_API_KEY
```

## Notes

- This script uses Node only (no Bun required).
- The Bearer API key is shown once. It's stored in OpenClaw config/.env if you configure OpenClaw.
- OpenClaw changes are reversible by removing the Loyal provider entries and LOYAL_API_KEY.
- Rerunning the setup when a configuration already exists lets you check balance and view the deposit address.

## Support

Email: rodion@askloyal.com  
Telegram: [t.me/spacesymmetry](https://t.me/spacesymmetry)
