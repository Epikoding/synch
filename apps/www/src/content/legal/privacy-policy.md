---
title: Privacy Policy
description: How Synch collects, uses, and protects information for the hosted service.
updatedDate: 2026-05-08
---

Last updated: May 8, 2026

This Privacy Policy explains how Synch ("Synch", "we", "us", or "our") collects, uses, shares, and protects information when you use the hosted Synch service, including the Synch website, API, hosted sync infrastructure, and related account features (the "Service").

Synch is designed for end-to-end encrypted Obsidian sync. Vault file contents and file path metadata are encrypted by the client before leaving your device. Synch cannot read your plaintext notes, plaintext file paths, or plaintext vault keys.

This Privacy Policy applies to the hosted Synch Service. It does not govern independent self-hosted deployments operated by other people or organizations.

## 1. Information We Collect

### Account Information

When you create or use an account, we may collect information such as your name, email address, email verification status, account identifiers, organization identifiers, membership records, invitation records, and authentication records.

If you use password-based login, Synch stores authentication data needed to verify your login. We do not store your account password in plaintext.

### Authentication And Session Information

We collect information needed to operate sessions and protect accounts, including session identifiers, session tokens, expiration timestamps, IP addresses, User-Agent strings, device authorization records, and related security metadata.

### Vault And Sync Metadata

To provide sync, quotas, collaboration, version history, and service health features, Synch processes operational metadata such as vault identifiers, vault names, active key versions, membership status, local vault identifiers, entry identifiers, blob identifiers, encrypted metadata records, revision numbers, sync cursors, commit records, timestamps, file sizes, storage usage, storage limits, deletion status, version-history records, health status, and maintenance job state.

This metadata helps the Service decide what changed, which encrypted blobs belong to a vault, which devices are up to date, whether storage limits are exceeded, and whether maintenance tasks are needed.

### Encrypted Vault Data

The Synch Obsidian plugin encrypts vault file contents and file path metadata on your device before uploading them. Synch stores encrypted blobs and encrypted sync metadata. We cannot decrypt this data without the user-held secrets needed by the client.

### Wrapped Key Envelopes

Synch stores wrapped key envelopes so authorized clients can unlock a vault using user-held secrets. These records may include key version, wrapper type, key-derivation metadata, salts, nonces, wrap algorithm metadata, and encrypted wrapped key material.

Synch does not store plaintext vault keys. A wrapped key envelope is encrypted key material, not the plaintext vault key.

### Billing Information

Synch offers paid subscription plans for the hosted Service. Billing is handled by Polar. Synch may receive and store billing-related identifiers and status, such as Polar customer IDs, checkout IDs, subscription IDs, product IDs, subscription status, renewal periods, cancellation status, and the email address used for checkout.

Polar may collect and process payment details under its own terms and privacy policy. Synch does not store complete payment card numbers.

### Communications And Support

If you contact us, we may collect your email address, message contents, troubleshooting details, and any other information you choose to provide.

### Website And Technical Information

When you visit the website or use the API, we and our infrastructure providers may process technical information such as IP address, request metadata, browser or client type, timestamps, error logs, and security logs.

We do not currently use advertising trackers or targeted advertising analytics in the Service. If that changes, we will update this Privacy Policy as appropriate.

## 2. Information We Cannot Access

Synch is designed so that we cannot access:

- Plaintext contents of your synced vault files.
- Plaintext file paths or filenames for synced vault files.
- Plaintext vault keys.
- The password or secret you use locally to unwrap and use vault keys.

Because we cannot access that plaintext data, we generally cannot review, moderate, recover, export, search, or disclose plaintext vault contents or plaintext paths.

## 3. How We Use Information

We use information to:

- Create, authenticate, and secure accounts.
- Provide encrypted vault sync, storage, collaboration, version history, and device coordination.
- Store and retrieve encrypted blobs and encrypted metadata.
- Enforce quotas, file-size limits, plan limits, and abuse-prevention controls.
- Operate, monitor, debug, protect, and improve the Service.
- Send account, security, support, service, and billing notices.
- Process billing and subscription status.
- Respond to requests, support inquiries, legal obligations, security incidents, and policy violations.

## 4. How We Share Information

We do not sell personal information. We do not share personal information for targeted advertising unless we later add that practice and update this Privacy Policy.

We may share information with:

- Infrastructure providers, including Cloudflare, for hosting, storage, networking, databases, queues, workers, security, and related infrastructure.
- Polar for checkout, subscription management, customer portal sessions, payment processing, and related billing operations.
- Email delivery providers, if email features are configured.
- Professional advisers, auditors, or service providers who help us operate the Service.
- Law enforcement, regulators, courts, or other parties when we believe disclosure is required by law or necessary to protect rights, safety, security, or the integrity of the Service.
- A successor or acquirer in connection with a merger, acquisition, financing, reorganization, or sale of assets, subject to appropriate confidentiality protections.

Third-party service providers may process information in countries other than your own and according to their own service terms and privacy commitments.

## 5. Cookies And Local Storage

Synch uses cookies, local storage, or similar technologies as needed for authentication, session management, account security, and website functionality.

We do not currently use cookies for targeted advertising. If analytics or advertising technologies are added later, we will update this Privacy Policy and provide choices where required.

## 6. Retention And Deletion

We retain account, billing, vault, sync, and operational records for as long as needed to provide the Service, comply with legal obligations, resolve disputes, enforce agreements, maintain security, prevent abuse, and operate backups and logs.

When you delete an account or vault, Synch will delete or schedule deletion of associated service records and encrypted blobs, subject to operational queues, backups, logs, legal obligations, security needs, and abuse-prevention needs.

Encrypted version-history records, deleted blob records, and maintenance records may persist for limited operational periods before deletion or compaction.

## 7. Your Choices And Rights

You may be able to access, correct, export, or delete certain account and vault information using the Service. You may also contact us at contact@synch.run to request access, correction, deletion, portability, or other privacy rights available under applicable law.

Depending on where you live, you may have rights to know what personal information we collect, request deletion or correction, object to or restrict certain processing, request portability, withdraw consent where processing is based on consent, or appeal a decision about your request.

We may need to verify your identity before completing a request. Some information may be retained where permitted or required by law, including for security, fraud prevention, legal compliance, billing, dispute resolution, or backup integrity.

Because Synch cannot decrypt your vault data, privacy requests generally cannot produce plaintext note contents or plaintext file paths from the hosted Service.

## 8. Security

We use technical and organizational measures intended to protect information, including HTTPS/TLS in transit, access controls, Cloudflare-hosted infrastructure, client-side encryption for vault data, AES-GCM encrypted vault payloads, and wrapped key envelopes.

No method of transmission, storage, or operation is perfectly secure. You are responsible for protecting your devices, Obsidian vaults, account credentials, vault passwords, encryption keys, recovery materials, and backups.

## 9. International Processing And Data Location

Synch and its service providers may process and store information in countries other than where you live. Cloudflare R2 and related Cloudflare services may store or process data according to Cloudflare configuration, infrastructure, and data-location settings.

By using the Service, you understand that information may be processed outside your jurisdiction, subject to applicable law.

## 10. Children

The Service is not intended for children under 13, or the minimum age required in your jurisdiction to use online services without parental consent. We do not knowingly collect personal information from children in violation of applicable law. If you believe a child provided personal information to Synch, contact us at contact@synch.run.

## 11. Open Source Transparency

Synch source code is published on GitHub under the MIT License. You may inspect the client and server code to understand how encryption and sync are implemented.

This Privacy Policy still governs how the hosted Synch Service collects, uses, shares, and retains information. Independent self-hosted deployments are controlled by their own operators.

## 12. Changes To This Privacy Policy

We may update this Privacy Policy from time to time. If we make material changes, we will provide notice through the Service, by email, or by another reasonable method. The updated Privacy Policy will become effective when posted unless a later date is stated.

## 13. Contact

Questions or requests about this Privacy Policy may be sent to:

Synch  
contact@synch.run
