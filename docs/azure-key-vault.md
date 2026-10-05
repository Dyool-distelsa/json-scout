# Azure Key Vault plugin

The Azure Key Vault plugin lets you pull a secret from an Azure Key Vault into the JSON Scout editor, edit it, review exactly what changed, and push the result back as a new version of the secret.

This guide covers everything you need after downloading an approved release from the [Releases page](https://github.com/Dyool-distelsa/json-scout/releases): requirements, sign-in, daily use and troubleshooting. For exact release, architecture, hash, update and uninstall gates, use the [canonical installation runbook](installation.md).

> **Before closing or updating:** startup and main-window close clear `vault-sync`, including saved but unpushed edits. Push explicitly or use **File > Save As** to make a protected copy manually first. The plugin never exports secrets automatically; protect backups with OS access controls and do not log secret values.

## What the plugin does and does not do

It does:

- List the secrets in a vault you name.
- Pull one secret into a local working copy and open it in the editor.
- Let you edit it with the normal JSON tools.
- Show a review dialog (a diff with masked values) before anything is sent.
- Push your edit as a **new version** of the same secret. Older versions stay in the vault.

It does not:

- Create, delete or purge secrets.
- Manage vaults, access policies or role assignments.
- Show or restore older versions of a secret.
- Read, store or log your Azure credentials. The app runs the Azure CLI (`az`) and relies on the session the CLI already has. It never sees a token.

## Requirements

| Requirement | Details |
| --- | --- |
| Operating system | Stable Windows and Linux targets. macOS builds are experimental and not a verified/supported Key Vault target. |
| Azure CLI | Installed and available on your `PATH`. Install it from the [official instructions](https://learn.microsoft.com/cli/azure/install-azure-cli); no minimum CLI version is asserted here. |
| Azure account | A user-approved account, tenant and default subscription that can read (and, to push, write) secrets. See [Azure permissions](#azure-permissions). |
| Network | List, pull and push require the user's configured network route, firewall rules and any private-endpoint access. |

How the app finds the CLI: on non-Windows systems it starts `az` through `PATH`. On Windows it first looks for a validated Azure CLI ZIP runtime so redirected JSON stays UTF-8; otherwise it keeps the existing `az.cmd` `PATH` fallback. If you installed or changed the CLI while JSON Scout was running, open a fresh terminal for `PATH` checks and restart the app.

End-user installs do not need Node.js or Rust. Do not silently install either as a fallback for a missing CLI or a failed release install.

### Windows ZIP runtime and UTF-8 output

The Windows Azure CLI ZIP is supported from any extraction folder. When its layout can be paired safely, JSON Scout invokes the bundled interpreter directly with:

```text
python.exe -X utf8 -I -B -m azure.cli <the original az arguments>
```

The original CLI arguments remain separate process arguments; values are not joined into a shell command. The child also receives `AZ_INSTALLER=ZIP`. Before using this path, the app validates all of these files under one ZIP root:

```text
<root>/bin/az.cmd
<root>/python.exe
<root>/Lib/site-packages/azure/cli/__main__.pyc   (or __main__.py)
```

Resolution is deliberately narrow and does not read or execute wrapper scripts:

1. `AZURE_CLI_PATH` or `AzureCLIPath`, when it names a ZIP `bin` directory, wins after layout validation.
2. Otherwise, the first `PATH` directory containing `az.cmd` is paired only if its parent has the complete ZIP layout.
3. If that `az.cmd` is the known Scoop `shims` entry, the app checks Scoop's `apps/azure-cli/current` layout using `SCOOP`, `SCOOP_GLOBAL`, or `%USERPROFILE%\scoop` conventions.
4. If no complete pairing is established, the app falls back to the normal `az.cmd` launch.

These checks pair files; they are not authenticity or signature verification. A fallback launch still decodes stdout strictly as UTF-8 and is **not** a guarantee that an unsupported installation's encoding issue is repaired. A failed direct invocation is reported once; the app does not silently retry a secret operation through another CLI installation.

Check the CLI from a terminal:

```powershell
az --version
```

> Note for Linux: when a command times out, the app stops only the process it started. The Azure CLI's own helper processes may keep running for a while. This is a known follow-up and does not affect normal use.

## Azure permissions

Access to a vault is decided by your organisation, not by JSON Scout. The plugin needs these operations on **secrets**:

| Task | Needed permission |
| --- | --- |
| Load the list and pull a secret | list and get |
| Push a new version | set (in addition to the above, because a push also reads the current version) |

Key Vaults use one of two permission models. Ask your Azure administrator which one the vault uses and whether your account has the access you need.

- **Azure RBAC**: the built-in role **Key Vault Secrets User** allows reading. **Key Vault Secrets Officer** allows reading and writing.
- **Vault access policy**: the secret permissions **Get**, **List** and **Set**.

Management-plane **Reader** alone is not enough for secret data-plane access. Ask the administrator to grant the narrow role or policy needed; JSON Scout never assigns broad roles automatically.

Secret listing exposes secret names. Do not run it automatically as a smoke test or dump its output. If the user explicitly approves a local access check, run the command below in a user-controlled terminal, review the names locally, and share none by default:

```powershell
az keyvault secret list --vault-name <approved-vault-name>
```

A successful list is evidence only for that user, vault and network path. A firewall or private endpoint must also allow the machine through it.

## Sign in

The plugin uses your existing Azure CLI session. Sign-in is an interactive, user-approved action; browser prompts and MFA may be required. Use either option:

- In a terminal, run:

  ```powershell
  az login
  ```

- Or click **Sign in to Azure** in the plugin's panel. The app runs `az login` for you, which opens your browser. It waits up to 5 minutes for you to finish. If the time runs out, the panel says "Sign-in did not finish in time. Try again."

Once you are signed in, the panel shows `Signed in as <your account> · <subscription>`.

From a fresh terminal, `az --version` is only a local CLI smoke check. It does not prove cloud access or permissions. If the user explicitly asks to inspect the active account, use `az account show` only with approval, query the minimum metadata needed, sanitize subscription/tenant identifiers, and do not log or paste the output.

### Choosing the subscription

The app does not pass a subscription to the CLI, so it uses the CLI's **default subscription**. Vaults are found by name, so normally this does not matter. If the vault is in a different subscription and Azure reports that it was not found, select the right one in a terminal and try again:

```powershell
az account set --subscription "<subscription name or id>"
```

## Turn the plugin on

The plugin is off by default and the choice is remembered between launches.

1. Click **Plugins** in the toolbar.
2. Switch **Azure Key Vault** on.
3. The left sidebar now has two tabs, **Files** and **Vault**. Open **Vault**.

The plugin only works in the desktop app. It is not available when the page runs in a browser.

If you are not signed in, the Vault tab shows "Sign in to Azure to browse Key Vault secrets." with the **Sign in to Azure** button. If the Azure CLI cannot be found, it shows a message with a **Check again** button instead.

## Use the plugin

### 1. Load a vault

1. Type the vault name in the **Key Vault name** field. Use the name only, not the URL. Example: `kv-myteam-dev`.
2. Click **Load**.

Name rules: letters, digits and hyphens only, 1 to 127 characters, and it must not start with a hyphen. A name that breaks the rules is refused before anything is sent to Azure.

The last 8 vaults you loaded appear as buttons under the field. Click one to load it again. The list is stored on your computer and contains vault names only.

Once the secrets appear, use **Search secrets** to filter by name (case-insensitive, matches any part of the name). The summary line shows the vault name and how many secrets are listed. A secret that is disabled in Key Vault carries a **disabled** tag.

### 2. Understand the row badges

Each secret has a badge that describes its local working copy.

| Badge | Meaning |
| --- | --- |
| `remote` | Not pulled yet. Nothing exists on your computer. |
| `clean` | Pulled, and the working copy is identical to what was pulled. |
| `modified` | Pulled, and the working copy differs from what was pulled. |

### 3. Pull a secret

1. Click **Pull** on the secret's row.
2. The working copy opens in the editor and a toast confirms `Pulled "<name>" from <vault>.`

If the row is `modified`, pulling would discard your edits, so the row asks first: **Discard local edits?** with **Discard and pull** and **Cancel**.

### 4. Edit and save

Edit the content in the editor and save with **Ctrl+S** (or **File > Save**). The file is saved to the working copy, and the row changes to `modified`. A **Push** button appears next to **Pull**. If the badge does not change straight away, click back into the app window. The list re-checks the files from disk when the window regains focus.

You can use any JSON Scout tool on the content. Remember that the pushed value is the saved file, so save after using Format, Minify or Sort keys.

### 5. Review and push

1. Click **Push** on the `modified` row. The app checks your file and asks Azure for the current version of the secret.
2. If nothing differs from what you pulled, a toast says **No changes to push** and nothing else happens.
3. Otherwise the **Push to Azure Key Vault** dialog opens. It shows:
   - An environment badge in the header (see below).
   - The vault, the secret name and the version your edit is based on.
   - A **Your edits** section. For JSON it lists changes by key path (added, changed, removed, moved). For plain text it lists changed lines.
   - Values are masked (`••••••`). Click **Reveal values** to show them and **Hide values** to mask them again.
4. Click **Push** to send it. For some vaults you must type the secret name first (see below).
5. A toast confirms `Pushed <name> (v <short version>)`, and the row returns to `clean`.

Pushes appear in Azure as your account.

#### Environment colour and typed confirmation

The dialog infers the environment from the **end of the vault name**: the text after the last hyphen, compared without regard to case.

| Vault name ends with | Environment badge | Extra confirmation |
| --- | --- | --- |
| `-dev` | DEV | None |
| `-qa` | QA | None (highlighted as a caution) |
| `-stg` | STG | None (highlighted as a caution) |
| `-prod` or `-main` | PROD | Type the secret name |
| anything else | UNKNOWN | Type the secret name |

Examples: `kv-myteam-dev` is DEV, `kv-myteam-PROD` is PROD, `kv-myteam` is UNKNOWN, `kv-myteam-production` is UNKNOWN, `kv-myteam-dev-1` is UNKNOWN.

When typed confirmation applies, the **Push** button stays disabled until you type the secret name exactly as shown. Capital letters and surrounding spaces count.

#### Conflicts

The review dialog checks the vault again each time. A conflict means the secret's current version in Azure is not the version you pulled. Someone else (or another tool) pushed after you.

The dialog then adds a **Changed in Azure** section and a notice such as "This secret changed in Azure since you pulled it", and offers:

- **Re-pull**: closes the dialog and starts a pull from the current value. Because the row is `modified`, it asks before discarding your edits.
- **Overwrite anyway**: pushes your version on top.

Overwrite is deliberately narrow. It only replaces the exact version shown to you in the dialog. If the vault changes again after you opened the dialog, the push is refused and the dialog offers **Review again**, so you never overwrite a version you did not see.

The same **Review again** button appears if the preview is older than 5 minutes or is otherwise out of date.

### 6. Close the window

Closing the window discards the local working copies (see below). If any pulled secret has unpushed edits, the app asks first with the title **Unpushed edits**: "N secrets have unpushed edits. Close and discard them?", listing `vault/name` entries. Choose **Keep editing** to stay, or **Discard and close** to leave. This question appears even when the plugin is switched off, because the files exist either way. Before closing or updating, push explicitly or use **File > Save As** to make a protected copy manually; saved edits are still unpushed until the push succeeds.

## Diagnostics and issue reports

When status, sign-in, list, pull, or a panel-owned push check fails, the toast names the operation and safe reason. The Vault panel also keeps the **Last diagnostic** section after the toast expires.

1. Open **View full report** in **Last diagnostic**.
2. Choose **Copy report**.
3. If clipboard access is unavailable, select the report in the expanded text box and copy it manually.

The report is retained in memory for the current app session only. It is not written to disk, added to the vault working folder, or published to GitHub. It contains only the operation, classified reason, safe parser metadata (when present), and the app version when available. It does not include vault or secret names, paths, secret values, credentials, or Azure CLI output. Review it yourself before sharing; never attach secret values or raw terminal/CLI logs.

## Where the files live

Pulled secrets are stored in the application data folder. On Windows:

```text
%APPDATA%\com.dyool.json-scout\vault-sync\
```

(for example `C:\Users\<you>\AppData\Roaming\com.dyool.json-scout\vault-sync\`). This is Tauri's per-app data directory for the identifier `com.dyool.json-scout`. On Linux Tauri uses `~/.local/share/com.dyool.json-scout/vault-sync/`.

Inside it, there is one folder per vault:

| Path | Purpose |
| --- | --- |
| `<vault>/<secret>.json` or `.txt` | The working copy you edit. |
| `<vault>/.base/<secret>.json` or `.txt` | An unmodified copy of what was pulled. Used to detect edits and to build the diff. |
| `<vault>/<secret>.meta.json` | The version it was pulled from, the pull time and the format. Contains no secret value. |
| `.tmp/` | Short-lived staging files used during a push. |

Do not edit or move the `.base` and `.meta.json` files.

The whole `vault-sync` folder is **deleted** when the app starts and when the main window closes. Anything you have not pushed is lost at that point, so push before you close.

You can open the working copy in any other editor. Saving it there counts as an edit too.

## How content is formatted

- A secret whose value is a JSON object or array is stored as a `.json` file and pretty-printed with 2-space indentation. The formatting is lossless: key order is kept, and numbers and strings keep their exact text (for example `1.0` stays `1.0`).
- On push, JSON is sent minified (no extra whitespace). The secret's content type is set to `application/json`.
- Anything else is a text secret: plain passwords, tokens, JSON scalars such as `123` or `true`, and text that is not valid JSON. It is stored as a `.txt` file and pushed exactly as saved, with no changes.
- A JSON edit that only changes whitespace is not a change: if the minified content is identical, you get **No changes to push**. If only the key order differs, the dialog opens and reports "No key-level changes (formatting or key order only)".
- A JSON working copy that is not valid JSON, or that repeats a key within the same object, cannot be pushed. See the troubleshooting table.

## Security notes

- The app never reads or stores your Azure credentials. It runs `az` and uses its session.
- A secret value is never passed as a command-line argument, so it cannot show up in a process list. A push writes the value to a temporary file under `vault-sync\.tmp`, passes the file to `az`, and deletes it afterwards.
- Secret values are not written to logs. The review dialog masks them until you choose **Reveal values**, and the push toast shows only the name and a short version id.
- Secret values exist on disk only while the app is open (see [Where the files live](#where-the-files-live)); startup and window-close cleanup are intentional.
- Backups are a manual user action and inherit the operating system's file security. Do not log them or place them in an unprotected shared location.
- The plugin never deletes or purges anything in Azure.

## Troubleshooting

The text in the first column is what the app shows. Some messages come from the app, some from the Azure CLI.

| What you see | Cause | What to do |
| --- | --- | --- |
| Not signed in to Azure. Run `az login` and retry. The panel shows **Sign in to Azure**. | No Azure CLI session, or it expired. | Click **Sign in to Azure**, or run `az login` in a terminal. |
| Your Azure session has ended. Sign in again to continue. | The session ended while the panel was open. | Sign in again. Your local files are kept. |
| Sign-in was not completed. Try again. / Sign-in did not finish in time. Try again. | You closed the browser window, or sign-in took longer than 5 minutes. | Click **Sign in to Azure** again, or use `az login` in a terminal. |
| Azure CLI (az) not found. Install it, make sure it is on your PATH, then retry. / The Azure CLI (az) is required for Azure Key Vault. | The app could not start `az` (`az.cmd` on Windows). | Install the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), confirm `az --version` works in a new terminal, restart JSON Scout, and click **Check again**. |
| You do not have access to read or write this vault or secret. | Your account lacks list, get or set on secrets, or a firewall blocks you. | With explicit user approval, check permissions using the command in [Azure permissions](#azure-permissions); never dump the returned names. Ask your Azure administrator. |
| The vault or secret was not found. | Wrong vault name, wrong subscription, or the secret no longer exists. | Check the spelling. With explicit approval, inspect minimal account metadata safely, then use `az account set --subscription` if needed. Do not log or paste the output. |
| The Azure CLI took too long to respond. Retry in a moment. | An `az` call took more than 60 seconds (network or firewall). | Check your connection and retry. |
| Names may only contain letters, digits and hyphens (not starting with a hyphen), up to 127 characters. | The vault name breaks the rules. | Enter the vault name, not its URL. |
| The secret changed in Azure after you pulled it. Re-pull it, or overwrite the vault's version. | Someone pushed a newer version. | Use **Re-pull** to start from the current value, or **Overwrite anyway** if you are sure. |
| The preview is out of date. Review the changes again before pushing. | The preview expired (5 minutes), the file changed after the preview, or the secret was pulled again. | Click **Review again**. |
| There are no changes to push. / No changes to push | The working copy is equivalent to what was pulled. | Nothing to do. Make and save an edit first. |
| The working copy is not valid JSON (line N, column M). Fix it and try again. | The saved JSON has a syntax error at that position. | Fix it in the editor (the lint gutter helps), save, and push again. |
| The JSON repeats a key in the same object (at line N...). Remove or rename the duplicates, then preview again. | An object has the same key twice. JSON allows it, but the pushed value would be ambiguous. | Remove or rename the duplicate keys, save, and push again. |
| This secret has no local working copy. Pull it before pushing. | The working copy was deleted or the pull never finished. | Pull the secret again. |
| `<operation> failed: Azure command failed.` | The Azure CLI command failed and the backend could not classify the cause into a more specific safe reason. | Use the **Last diagnostic** report in the Vault panel. If needed, run the matching command in a terminal yourself; JSON Scout does not copy the CLI output into the report. |
| Could not understand the response from the Azure CLI. | `az` returned unexpected output. | Update the Azure CLI and retry. |
| File system error: ... | The app could not read or write its working folder. | Check disk space and permissions on the folder in [Where the files live](#where-the-files-live). If the message says the secret was pushed but the local copy could not be updated, pull it again before editing. |

## FAQ

**Does it work offline?** Azure listing, pulling and pushing need network access. A pulled working copy can be reviewed or edited locally during an outage, but it cannot be refreshed or pushed until access returns. This is not a universal offline claim for the rest of JSON Scout.

**Can I use several vaults?** Yes. Load one vault name at a time. Recent vaults are one click away, and each vault has its own working folder.

**Do my pulled files survive a restart?** No. The workspace is cleared when the app starts and when it closes. Push first.

**What do I include in a bug report?** The version shown in the status bar (for example `v<version> · <commit>`). Hover it to see the full commit and the build date. Describe the steps and the message you saw. Do not include secret values, account metadata, or real vault contents.
