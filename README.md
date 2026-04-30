# Synch

Synch is an Obsidian Sync alternative for end-to-end encrypted vault synchronization.
It is currently in beta.

Synch is an independent community plugin and service. It is not affiliated with
Obsidian.

## Install with BRAT

Synch is not yet available through the Obsidian Community Plugins directory. To install the Obsidian plugin with [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable `Obsidian42 - BRAT` from Obsidian Community Plugins.
2. Open the command palette and run `BRAT: Add a beta plugin for testing`.
3. Paste `https://github.com/hjinco/synch`.
4. Add the plugin, then refresh the Community Plugins list.
5. Enable `Synch`.

BRAT installs beta plugins from GitHub releases and can update them from its own settings or commands.

## How to use Synch

1. Install and enable the plugin.
2. Open Synch's settings in Obsidian.
3. Sign in to a Synch account from the plugin.
4. Create or connect a remote vault.
5. Keep Obsidian open while Synch uploads local changes and downloads remote changes.

Synch syncs Markdown files by default. Images, audio, videos, and PDFs are also
enabled by default. Other file types are disabled by default and can be enabled
from the plugin settings. Hidden folders and hidden files are skipped, and you
can exclude additional folders in settings.

When the same path is changed in incompatible ways on different devices, Synch
keeps the conflicting content by writing a conflict copy in the vault instead of
silently discarding it.

The plugin can use the hosted Synch Cloud API or a custom API base URL for a
self-hosted deployment.

## Disclosures

This section is provided for Obsidian developer policy review and for users who
want to understand what the plugin does before installing it.

### Account requirements

Synch requires a Synch account to use the hosted sync service. The account is
used to authenticate devices, create and connect remote vaults, issue sync
tokens, enforce storage limits, and manage service access.

### Network use

Synch connects to the configured Synch API base URL over HTTPS and WebSocket
connections. For the hosted service, this is Synch-operated infrastructure. The
default hosted API endpoint is `https://api.synch.run`, and realtime sync uses
`wss://api.synch.run` WebSocket connections. The plugin uses network requests
to:

- Sign in and maintain an authenticated device session.
- Create, list, and connect remote vaults.
- Upload encrypted file blobs and encrypted sync metadata.
- Download encrypted file blobs and encrypted sync metadata.
- Exchange realtime sync messages over WebSocket connections.
- Read account, billing, quota, storage, and sync status.

Synch-hosted infrastructure uses third-party providers, including Cloudflare for
hosting, storage, networking, databases, queues, and related infrastructure.
Billing, if enabled, may be handled by Polar or another payment provider.

### Data sent to Synch

Vault file contents and file path metadata are encrypted on your device before
they are uploaded. Synch stores encrypted blobs and encrypted sync metadata and
is designed so that the hosted service cannot read your plaintext notes,
plaintext file paths, or plaintext vault keys.

End-to-end encryption does not hide all operational metadata. Synch may process
account information, vault identifiers and names, organization and membership
records, local vault identifiers, blob identifiers, file sizes, storage usage,
timestamps, sync cursors, session information, IP addresses, User-Agent strings,
billing identifiers if billing is enabled, and similar operational metadata.

### Local vault access

Synch reads and writes files inside the current Obsidian vault so it can sync
selected vault files. It stores plugin settings with Obsidian's plugin data API,
stores the device session token with Obsidian's secret storage API, and stores
local sync state in browser IndexedDB.

Synch does not intentionally read or write files outside the current Obsidian
vault.

### Payments

Synch is currently in beta. The hosted service may offer free, beta, trial,
paid, or limited plans. Paid plans are planned but may not be generally
available yet. If paid plans are enabled, payment processing may be handled by
Polar or another third-party payment provider.

### Telemetry, ads, and privacy

The Synch Obsidian plugin does not include client-side telemetry and does not
show ads. The hosted service may process operational logs and service metadata
needed to run, secure, troubleshoot, and improve the service.

For details, read the hosted service legal documents:

- [Privacy Policy](https://synch.run/privacy)
- [Terms of Service](https://synch.run/terms)

### Source code

Synch is open source under the MIT License. The source code for the plugin,
hosted API, and website is published in this repository.
