# loyal-openclaw-client

Public, Node-only setup script for Loyal-OpenClaw users.

## One-liner setup (recommended)

Requires Node.js 18+.

```bash
curl -fsSL https://raw.githubusercontent.com/cosmicsymmetry/loyal-openclaw-client/main/loyal-openclaw-setup.js | node
```

Or via the helper installer (also Node-only):

```bash
curl -fsSL https://raw.githubusercontent.com/cosmicsymmetry/loyal-openclaw-client/main/install.sh | bash
```

The setup uses the hosted Loyal-OpenClaw server by default (no URL needed).

## What it does

- Generates or reuses an Ed25519 keypair in `~/.loyal-openclaw/`
- Registers your public key with the server
- Optionally sets your Solana wallet for deposits
- Shows deposit instructions
- Creates a Bearer API key (shown once)
- Configures your OpenClaw provider config (and `~/.openclaw/.env`)

## Files written

```
~/.loyal-openclaw/
├── id_ed25519      # Private key (PEM)
├── id_ed25519.pub  # Public key (base64)
└── config.json     # server_url, api_key
```

```
~/.openclaw/
├── openclaw.json   # Provider config updates (if OpenClaw CLI isn't used)
└── .env            # LOYAL_API_KEY
```

## Notes

- This script uses Node only (no Bun required).
- The Bearer API key is shown once and stored locally.
- OpenClaw changes are reversible by removing the Loyal provider entries and LOYAL_API_KEY.
