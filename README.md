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

Optional: prefill the server URL (otherwise you will be prompted):

```bash
LOYAL_SERVER_URL=http://your-loyal-openclaw-host:3000 \
  curl -fsSL https://raw.githubusercontent.com/cosmicsymmetry/loyal-openclaw-client/main/loyal-openclaw-setup.js | node
```

## What it does

- Generates or reuses an Ed25519 keypair in `~/.loyal-openclaw/`
- Registers your public key with the server
- Optionally sets your Solana wallet for deposits
- Optionally creates a Bearer API key
- Optionally updates your OpenClaw provider config

## Files written

```
~/.loyal-openclaw/
├── id_ed25519      # Private key (PEM)
├── id_ed25519.pub  # Public key (base64)
└── config.json     # server_url, api_key
```

## Notes

- This script uses Node only (no Bun required).
- The Bearer API key is shown once and stored locally.
