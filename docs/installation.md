# JSON Scout installation and Azure Key Vault runbook

This is the canonical runbook for installing JSON Scout across machines and for deciding whether the optional Azure Key Vault plugin is ready. It is written for people and for AI agents acting on a user's instructions.

> **Current release status:** `v0.2.4` remains unpublished. The current remote snapshot has five Windows/Linux assets with GitHub-reported SHA-256 digests in an unpublished draft; the separate macOS draft has zero assets. Install only an asset visibly present in a human-approved GitHub release or draft. Do not turn a tag, a draft, or an expected filename into a stable-download claim.

> **Important before closing or updating:** the Key Vault workspace is cleared when JSON Scout starts and when its main window closes. That includes saved, but unpushed, edits. Push explicitly, or manually export a protected copy with the editor's **File > Save As** before closing or updating. JSON Scout never exports secrets automatically. Protect any backup with the operating system's normal access controls and do not put secret values in logs.

## Quick path

1. Confirm the actual OS and architecture on the target machine.
2. Get human approval for the exact release tag, source URL, asset filename, and whether a draft/prerelease is acceptable.
3. From that release only, record the exact asset URL and SHA-256 provenance. Do not use a wildcard or a guessed filename.
4. Install using the platform section below, then launch JSON Scout and compare the status-bar version with the approved tag.
5. If Azure Key Vault is needed, install the Azure CLI separately, confirm it is on `PATH` in a fresh terminal, restart JSON Scout, and follow the plugin checklist.

## Platform and support status

| Target | Release artifacts | Status and boundary |
| --- | --- | --- |
| Windows | NSIS `.exe` and MSI | Stable target. The NSIS bundle is configured for a per-user install. Windows artifacts are unsigned; SmartScreen or Smart App Control may block them. |
| Linux | `.deb`, `.rpm`, and AppImage | Stable target. Use the package format for the installed distribution, or run the AppImage as a user file. |
| macOS Intel / Apple Silicon | No current release asset; the remote experimental draft has zero assets | Experimental only: ad-hoc signed and not notarized. Both native target builds/tests and DMG creation succeeded in the recorded run, but desktop smoke testing was not done; this is not a universal macOS support promise. |

Remote verification snapshots are recorded in the release notes: stable run `37368459103` succeeded on Windows and Ubuntu and created the unpublished `v0.2.4` draft with five assets and GitHub-reported SHA-256 digests; macOS run `37368447436` succeeded for both native builds/tests and DMG creation for target `d7f5dc8`, but its guarded upload failed and the macOS draft has zero assets. These snapshots are not published download availability. See the [stable notes](releases/v0.2.4.md) and [experimental macOS notes](releases/macos-v0.2.4.md).

### Runtime install versus source build

- **Runtime install:** Node.js, Rust, and MSVC build tools are not required. Windows also needs the **WebView2 Runtime** to run the desktop app. The Azure Key Vault plugin additionally requires the user's separately installed Azure CLI; it does not bundle a cloud credential or silently install a dependency.
- **Source build/development:** use the repository's Node.js/npm, stable Rust, Windows MSVC build tools, and the platform prerequisites in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/). WebView2 is a runtime prerequisite, not a build-tool substitute. A failed release install must not silently fall back to a source build.
- **Windows WebView2 installation plan:** `src-tauri/tauri.conf.json` does not set `bundle.windows.webviewInstallMode`. Tauri's documented unset default is `downloadBootstrapper`; verify that default against the [official Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/) for the pinned CLI during installer review. A fresh installer may therefore need network access to obtain the Microsoft bootstrapper. Offline installation is not guaranteed: if the runtime is absent, stop for an administrator-approved trusted runtime deployment; do not silently download, elevate, or change policy.

## Release approval and provenance checklist

Use these fields before downloading or installing. Replace every placeholder with an observed value; do not ask an agent to invent one.

```text
approved_tag: <exact tag, for example vX.Y.Z or macos-vX.Y.Z>
release_status: <published | draft/prerelease, explicitly approved by the user>
source_url: https://github.com/Dyool-distelsa/json-scout/releases/<exact-release>
asset_url: <exact URL copied from that release>
filename: <exact asset filename copied from that release>
os: <Windows | Linux distribution | macOS>
architecture: <actual result from the target machine>
release_commit: <commit shown by the release, if available>
published_sha256: <only if the official source publishes one>
local_sha256: <computed on the target machine>
verified_by_and_date: <human or agent record>
```

- Open the exact release page and confirm its tag, published/draft state, asset presence, platform, and architecture. A draft requires explicit approval; otherwise stop.
- Copy the filename exactly. Do not substitute a prepared version, a wildcard, or a name from an old release note.
- Compute a local SHA-256 and compare it with an official release checksum when one is published. If no official checksum is provided, record the local hash as provenance only; it is not independent authenticity evidence.
- Keep the release URL, filename, architecture, status, commit, and hashes in the handoff. Never put account identifiers, secret values, tokens, or raw CLI output in that record.

## Check the target architecture

Run only the local check for the target machine and record its output. Do not claim that an asset supports every architecture.

**Windows PowerShell**

```powershell
[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
```

**Linux**

```bash
uname -m
```

**macOS**

```bash
uname -m
```

If the release does not identify an asset for the observed architecture, stop and ask the user or maintainer. Do not “try the closest” binary.

## Install

### Windows: NSIS or MSI

The WebView2 Runtime is a Windows runtime prerequisite, separate from the NSIS per-user setting. With the repository's unset `webviewInstallMode`, the installer may need network access to obtain Tauri's WebView2 bootstrapper and local policy may require administrator-approved runtime deployment. Per-user JSON Scout installation does not guarantee an offline or elevation-free runtime setup. Stop if the runtime is absent or blocked; do not silently download, elevate, or change policy.

1. Close any running JSON Scout instance, especially before an update.
2. Use the exact approved NSIS `.exe` or MSI filename recorded above. The normal NSIS path is interactive and per-user; that does not remove the WebView2 runtime gate.
3. For the unsigned installer warning, choose **More info** → **Run anyway** only after the release source, tag, filename, architecture, and hash have been approved. Smart App Control can block unsigned apps; stop for an administrator-approved per-app policy path if permitted. Do not weaken Windows security globally.
4. Use unattended NSIS installation only when the user explicitly approves an unattended action and the file is the approved NSIS installer. The observed NSIS switch is:

   ```powershell
   Start-Process -FilePath '.\REPLACE_WITH_EXACT_NSIS_FILENAME.exe' -ArgumentList '/S' -Wait
   ```

   Do not apply `/S` to an MSI, and do not treat unattended completion as proof that the correct asset was chosen.
5. Use an MSI through Windows Installer only when that installation method is explicitly approved; it may require elevation:

   ```powershell
   msiexec /i '.\REPLACE_WITH_EXACT_MSI_FILENAME.msi'
   ```

   Do not guess a product code, package name, or install directory.

### Linux: package or AppImage

Inspect the package before granting `sudo`, and confirm its metadata matches the approved release. Replace the placeholder with the exact downloaded filename.

**Debian/Ubuntu**

```bash
dpkg-deb --info './REPLACE_WITH_EXACT_FILENAME.deb'
sudo apt install './REPLACE_WITH_EXACT_FILENAME.deb'
```

**Fedora/RHEL**

```bash
rpm -qip './REPLACE_WITH_EXACT_FILENAME.rpm'
sudo dnf install './REPLACE_WITH_EXACT_FILENAME.rpm'
```

Do not infer a package name from `JSON Scout`, a wildcard, or an old release. If metadata, architecture, or package identity is not what the user approved, stop. The package formats register JSON file handling; the Explorer context-menu feature is Windows-only.

**AppImage**

An AppImage is a user file, not a package-manager install:

```bash
chmod +x './REPLACE_WITH_EXACT_FILENAME.AppImage'
'./REPLACE_WITH_EXACT_FILENAME.AppImage'
```

Run it only after the exact file and hash have been reviewed. Do not silently install missing desktop libraries or switch to a source build.

### macOS: experimental DMG only

Install only if the approved experimental release visibly contains the matching Intel or Apple Silicon DMG. The expected names in the preparation notes are not evidence that either file exists.

1. Check `uname -m` and choose only the matching architecture.
2. Open the exact approved DMG in Finder and drag **JSON Scout** to **Applications**.
3. If Gatekeeper warns, use Finder's **Control-click → Open** for this app, or the one-app **System Settings → Privacy & Security → Open Anyway** action after reviewing the source. This is a user-managed approval for this one app.
4. Do not disable Gatekeeper globally, use `spctl --master-disable`, or use a blanket administrator override. If the source, architecture, or warning is unexpected, stop.

## Verify, update, and uninstall

### Verify the running app

Launch JSON Scout and read the status bar. A release build shows `v<version>` and may show a commit; compare the version to the approved tag. This confirms what the running app reports, not that a release was published or that another platform is supported.

For an update, repeat the provenance and architecture checks with the new exact asset. Close the old app first and follow the Key Vault warning at the top of this document. There is no documented automatic updater in this repository.

### Uninstall

- **Windows:** use **Settings → Apps → Installed apps**, select **JSON Scout**, and choose **Uninstall**. Do not guess an uninstaller filename or product code. The current Microsoft Installed apps URL was not verified in this repository, so use the current Windows Settings path rather than a guessed web link.
- **Linux `.deb`/`.rpm`:** identify the installed package from the package metadata or the distribution's package manager before removing it; do not invent a package name. Obtain explicit approval before a privileged removal. An AppImage has no package record: close JSON Scout and remove the user-owned AppImage through the file manager.
- **macOS:** close JSON Scout and move **JSON Scout.app** from **Applications** to the Trash. This does not turn the experimental build into supported macOS software.

Uninstalling does not create a secret backup. If a Key Vault working copy matters, push it explicitly or manually save a protected copy before uninstalling; never export secrets automatically.

## Azure Key Vault plugin readiness

The plugin is optional, off by default, and works only in the desktop app. It uses the user's existing Azure CLI session; it does not read or store Azure tokens. Read the [full Azure Key Vault guide](azure-key-vault.md) for the detailed UI and error reference.

### Prerequisites and approval boundaries

- Install Azure CLI from the [official Microsoft instructions](https://learn.microsoft.com/cli/azure/install-azure-cli). No minimum CLI version is asserted here.
- Confirm `az` is on `PATH` in a **new terminal**, then restart JSON Scout if the CLI was installed or changed while it was open. On Windows, a validated ZIP runtime or known Scoop `current` layout is paired for UTF-8 output; unsupported layouts use the existing `az.cmd` fallback, which is not guaranteed to repair encoding issues. This pairing is not authenticity verification.
- The end-user app does not need Node.js or Rust. Do not silently install either one as a fallback.
- The user or administrator must configure the Azure account, tenant, default subscription, network route, firewall rules, and private-endpoint access. JSON Scout does not grant access or change those settings.
- Read access needs `list` and `get` on secrets. Push needs `set` as well. With Azure RBAC, **Key Vault Secrets User** is the read role and **Key Vault Secrets Officer** covers read/write. With vault access policies, request **Get**, **List**, and **Set**. Management-plane **Reader** alone is not enough. Never automatically assign broad roles.

### Sign-in and safe local checks

1. Get approval for an interactive sign-in. Use **Sign in to Azure** in the Vault panel or run `az login` in a user-controlled terminal. Browser, MFA, tenant selection, and network prompts are interactive; do not claim headless automation is supported.
2. `az --version` is a local CLI availability smoke check only. It does not prove Azure access, vault permissions, or universal offline capability.
3. If the user explicitly asks to inspect the active account, use `az account show` only with approval. Query the minimum metadata needed, sanitize subscription/tenant identifiers, and do not log or paste the output. Never run a secret list automatically to “test” access: listing exposes secret names. If a user-approved access check is necessary, review the names locally and share none by default.

### Pull, edit, review, and explicit push

1. Open the desktop app, click **Plugins**, switch **Azure Key Vault** on, and open the **Vault** tab.
2. Enter the vault name in **Key Vault name** and click **Load**. Use the name, not the URL. The name must be 1–127 characters, start with a letter or digit, and contain only letters, digits, and hyphens.
3. Click **Pull** for a secret. `remote`, `clean`, and `modified` describe the local working copy. A modified copy requires **Discard and pull** before it can be replaced.
4. Edit and save with **Ctrl+S** or **File > Save**. Object/array values are stored as `.json`; scalars and other text are stored as `.txt`.
5. Click **Push**, inspect the masked **Push to Azure Key Vault** review, and reveal values only when necessary. Push is an explicit user action. Production/unknown environments require typing the secret name. On a conflict, choose **Re-pull** or the explicitly reviewed **Overwrite anyway** path.
6. Remember the close/update warning: saved edits are still unpushed until the push succeeds. The workspace is cleared at startup and window close.

The plugin is not available in a plain browser and its Azure list/pull/push operations need network access. Local review after a pull may continue during an outage, but that is not a claim that the plugin works offline.

### Diagnostics and handoff

Use **Last diagnostic** → **View full report** → **Copy report** when an operation fails. The report is allowlisted and omits vault/secret names, values, credentials, paths, and raw CLI output. Review it yourself before sharing; redact any surrounding notes and never attach secret contents or terminal logs.

## AI-agent checklist and stop outcomes

An agent may read documentation and perform local, non-secret checks, but must stop for human approval before a download choice, draft/prerelease install, unsigned-app bypass, unattended install, privileged package action, Azure sign-in, account/subscription inspection, role/network change, secret list, pull, edit, push, export, or deletion.

- [ ] User supplied or approved the exact tag, source URL, release status, filename, OS, architecture, and hash provenance.
- [ ] The observed architecture matches the selected asset; no universal support claim was made.
- [ ] The action is runtime installation, not an unrequested Node/Rust source build.
- [ ] For Key Vault, the user selected `plugin: off`, `read`, or `write`; `write` includes explicit review and push approval.
- [ ] Close/update risk was explained and any protected copy was made manually by the user.
- [ ] No credentials, secret values, secret names, raw CLI output, or sensitive account metadata entered logs or the handoff.

Stop and report the exact missing fact when: the release is absent/unpublished, the asset is missing, the hash disagrees, architecture is unclear, an installer warning is unexpected, the package metadata is unexpected, a dependency would need installation, Azure CLI is unavailable, sign-in is required, permissions/network access are insufficient, or a local file would be discarded.

### Delegation prompt template

```text
Target OS/distribution: <fill in>
Target architecture (observed locally): <fill in>
Approved JSON Scout version/tag: <fill in>
Approved source/release URL and status: <fill in>
Exact approved asset filename and URL: <fill in>
Hash provenance (official and/or local SHA-256): <fill in>
Key Vault plugin: <off | read | write>
Azure tenant/subscription/network approval: <fill in, or “not requested”>

Act only within these approvals. Verify the local architecture and exact asset metadata.
Do not install Node/Rust, log in to Azure, list secrets, change RBAC/network settings,
export secret values, or use a fallback source build without a new explicit approval.
For plugin=read, pull only the user-named secret after confirmation. For plugin=write,
show the masked diff and wait for an explicit push approval. Report checks, stop reasons,
and no-secret metadata only.
```

## Safe report template

```text
JSON Scout installation report
- OS/distribution:
- Architecture check:
- Approved tag and release status:
- Source/release URL:
- Exact asset filename:
- Release commit (if shown):
- Official SHA-256 (if published):
- Local SHA-256:
- Installer/package metadata result:
- Running app version from status bar:
- Azure CLI: present on PATH after fresh-terminal check (yes/no/not requested)
- Plugin mode: off/read/write
- Result or stop reason:

Do not include: secret values, secret names, vault names, tokens, credentials,
subscription/tenant identifiers, raw `az` output, or terminal logs.
```