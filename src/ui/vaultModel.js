/**
 * Pure helpers behind the Vault panel. No DOM, no Tauri, no storage access:
 * everything here is deterministic and unit tested (see vaultModel.test.js).
 */

/** How many recently used vault names the panel remembers. */
export const MAX_RECENT_VAULTS = 8;

/** Same rule as the backend: alphanumeric first character, then up to 126 more of [A-Za-z0-9-]. */
const VAULT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,126}$/;

const GENERIC_ERROR_MESSAGE = 'Vault request failed.';

// These sets mirror the serialized backend schema. Values outside them are
// ignored rather than displayed, so an exception or CLI payload cannot become
// part of a diagnostic report.
const DIAGNOSTIC_OPERATIONS = new Set([
  'account_show',
  'secret_list',
  'secret_get',
  'secret_set',
  'login',
]);
const DIAGNOSTIC_REASONS = new Set([
  'not_signed_in',
  'forbidden',
  'not_found',
  'az_missing',
  'command_failed',
  'timeout',
  'io_failure',
  'invalid_utf8',
  'invalid_json',
  'invalid_shape',
  'missing_field',
  'invalid_version',
  'invalid_name',
]);
// Exact field names emitted by the backend's Azure response parser.
const DIAGNOSTIC_FIELDS = new Set(['user.name', 'name_or_id', 'name', 'value', 'id']);
const OPERATION_LABELS = Object.freeze({
  account_show: 'Account status',
  secret_list: 'Secret list',
  secret_get: 'Secret pull',
  secret_set: 'Secret push',
  login: 'Sign-in',
});
const REASON_LABELS = Object.freeze({
  not_signed_in: 'Not signed in',
  forbidden: 'Access denied',
  not_found: 'Not found',
  az_missing: 'Azure CLI missing',
  command_failed: 'Azure command failed',
  timeout: 'Timed out',
  io_failure: 'Local I/O failed',
  invalid_utf8: 'Invalid UTF-8',
  invalid_json: 'Invalid JSON',
  invalid_shape: 'Unexpected response shape',
  missing_field: 'Required response field missing',
  invalid_version: 'Invalid version',
  invalid_name: 'Invalid name',
});
const METADATA_KEYS = ['exit_status', 'timed_out', 'line', 'column', 'field'];
const hasOwn = (value, key) =>
  value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSafeInteger = (value) => Number.isSafeInteger(value);

/**
 * Keep only the exact structured fields sent by the backend. This function
 * deliberately does not inspect `kind`, `message`, exception objects or any
 * other payload text.
 * @param {unknown} error
 * @returns {{ operation: string, reason: string, metadata: object }|null}
 */
export function normalizeDiagnostic(error) {
  let payload;
  try {
    payload = error?.diagnostic;
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  if (!DIAGNOSTIC_OPERATIONS.has(payload.operation) || !DIAGNOSTIC_REASONS.has(payload.reason)) {
    return null;
  }

  const metadata = {};
  if (isRecord(payload.metadata)) {
    if (isSafeInteger(payload.metadata.exit_status)) metadata.exit_status = payload.metadata.exit_status;
    if (typeof payload.metadata.timed_out === 'boolean') {
      metadata.timed_out = payload.metadata.timed_out;
    }
    if (isSafeInteger(payload.metadata.line) && payload.metadata.line >= 1) {
      metadata.line = payload.metadata.line;
    }
    if (isSafeInteger(payload.metadata.column) && payload.metadata.column >= 1) {
      metadata.column = payload.metadata.column;
    }
    if (DIAGNOSTIC_FIELDS.has(payload.metadata.field)) metadata.field = payload.metadata.field;
  }
  return { operation: payload.operation, reason: payload.reason, metadata };
}

function isNormalizedDiagnostic(value) {
  return (
    isRecord(value) &&
    DIAGNOSTIC_OPERATIONS.has(value.operation) &&
    DIAGNOSTIC_REASONS.has(value.reason) &&
    isRecord(value.metadata)
  );
}

function normalizedDiagnostic(value) {
  if (isNormalizedDiagnostic(value)) return normalizeDiagnostic({ diagnostic: value });
  return normalizeDiagnostic(value);
}

function diagnosticLabel(diagnostic) {
  return `${OPERATION_LABELS[diagnostic.operation]} failed: ${REASON_LABELS[diagnostic.reason]}.`;
}

/** @param {unknown} error @returns {string|null} */
export function diagnosticMessage(error) {
  const diagnostic = normalizedDiagnostic(error);
  return diagnostic ? diagnosticLabel(diagnostic) : null;
}

/** Same safe text is used for the transient toast and the persistent summary. */
export function diagnosticToast(error) {
  return diagnosticMessage(error);
}

function safeReportVersion(version) {
  if (typeof version !== 'string') return null;
  const value = version.trim();
  return value.length <= 64 && /^(?:\d+\.){2}\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) ? value : null;
}

/**
 * Render a compact, copyable report from an already-normalized diagnostic.
 * No free-form backend text is accepted here.
 * @param {unknown} diagnostic
 * @param {unknown} [appVersion]
 * @returns {string}
 */
export function diagnosticReport(diagnostic, appVersion) {
  const safe = normalizedDiagnostic(diagnostic);
  if (!safe) return '';
  const lines = ['JSON Scout vault diagnostic'];
  const version = safeReportVersion(appVersion);
  if (version) lines.push(`App version: ${version}`);
  lines.push(`Operation: ${safe.operation}`, `Reason: ${safe.reason}`);
  const metadataLines = METADATA_KEYS.filter((key) => hasOwn(safe.metadata, key)).map(
    (key) => `- ${key}: ${safe.metadata[key]}`
  );
  if (metadataLines.length > 0) lines.push('Metadata:', ...metadataLines);
  return lines.join('\n');
}

function hasDiagnosticPayload(error) {
  return isRecord(error) && hasOwn(error, 'diagnostic');
}

/**
 * Case-insensitive substring filter over secret names, preserving order.
 * @param {{ name: string }[]} items
 * @param {string} query
 * @returns {object[]} a new array
 */
export function filterSecrets(items, query) {
  if (!Array.isArray(items)) return [];
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (needle === '') return [...items];
  return items.filter(
    (entry) => typeof entry?.name === 'string' && entry.name.toLowerCase().includes(needle)
  );
}

/**
 * Whether `name` is acceptable as a vault name. The panel validates before
 * invoking so an invalid name never reaches the backend.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidVaultName(name) {
  return typeof name === 'string' && VAULT_NAME_PATTERN.test(name);
}

/**
 * Add `name` to a recent-vaults list: most recent first, de-duplicated
 * case-insensitively (the newest casing wins) and bounded to `max`.
 * An invalid name leaves the list unchanged.
 * @param {string[]} list
 * @param {string} name
 * @param {number} [max]
 * @returns {string[]} a new array
 */
export function rememberVault(list, name, max = MAX_RECENT_VAULTS) {
  const current = Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : [];
  const next = isValidVaultName(name)
    ? [name, ...current.filter((entry) => entry.toLowerCase() !== name.toLowerCase())]
    : current;
  return next.slice(0, Math.max(0, max));
}

/**
 * Restore the recent-vaults list from its stored JSON text. Anything
 * malformed yields an empty list; invalid and duplicate entries are dropped.
 * @param {string|null|undefined} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function parseRecentVaults(raw, max = MAX_RECENT_VAULTS) {
  if (typeof raw !== 'string' || raw === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of parsed) {
    if (!isValidVaultName(entry)) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.slice(0, Math.max(0, max));
}

function backendText(err) {
  const message = err?.message;
  return typeof message === 'string' && message !== '' ? message : null;
}

/**
 * Turn a rejected backend call into user-facing text. Backend errors are
 * `{ kind, message }`; a plain string or an Error is tolerated too.
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessage(err) {
  const diagnostic = diagnosticMessage(err);
  if (diagnostic) return diagnostic;
  const hasMalformedDiagnostic = hasDiagnosticPayload(err);
  if (typeof err === 'string') return err !== '' ? err : GENERIC_ERROR_MESSAGE;
  if (err instanceof Error) {
    return hasMalformedDiagnostic
      ? GENERIC_ERROR_MESSAGE
      : err.message !== ''
        ? err.message
        : GENERIC_ERROR_MESSAGE;
  }
  const kind = err?.kind;
  switch (kind) {
    case 'not_signed_in':
      return 'Not signed in to Azure. Run `az login` and retry.';
    case 'az_missing':
      return 'Azure CLI (az) not found. Install it, make sure it is on your PATH, then retry.';
    case 'forbidden':
      return 'You do not have access to read or write this vault or secret.';
    case 'timeout':
      return 'The Azure CLI took too long to respond. Retry in a moment.';
    case 'not_pulled':
      return 'This secret has no local working copy. Pull it before pushing.';
    case 'no_changes':
      return 'There are no changes to push.';
    case 'preview_required':
      return 'The preview is out of date. Review the changes again before pushing.';
    case 'conflict':
      return "The secret changed in Azure after you pulled it. Re-pull it, or overwrite the vault's version.";
    // These two carry the line and column in the backend text, never the value.
    case 'invalid_json':
      return (
        (hasMalformedDiagnostic ? null : backendText(err)) ??
        'The working copy is not valid JSON. Fix it and try again.'
      );
    case 'duplicate_keys':
      return (
        (hasMalformedDiagnostic ? null : backendText(err)) ??
        'The JSON repeats a key in the same object. Remove the duplicate and try again.'
      );
    default: {
      if (hasMalformedDiagnostic) return GENERIC_ERROR_MESSAGE;
      const message = err?.message;
      return typeof message === 'string' && message !== '' ? message : GENERIC_ERROR_MESSAGE;
    }
  }
}

/**
 * Pulling over a locally edited secret would discard those edits, so the
 * panel asks first.
 * @param {{ localState?: string }|null|undefined} item
 * @returns {boolean}
 */
export function needsPullConfirmation(item) {
  return item?.localState === 'modified';
}

/**
 * Whether a rejected backend call means the Azure session is gone.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isSignedOutError(err) {
  return err?.kind === 'not_signed_in';
}

/** What the panel knows about the Azure session before any call has finished. */
export const INITIAL_SESSION = Object.freeze({
  identity: null,
  error: null,
  checking: false,
  signingIn: false,
});

const NOT_SIGNED_IN = Object.freeze({ kind: 'not_signed_in' });

/**
 * Next session state for an event. Returns a new object and never mutates its
 * input; unknown events leave the state unchanged.
 * Events: check, checked{identity}, check-failed{error}, check-cancelled,
 * sign-in, signed-in{identity}, sign-in-failed{error}, expired.
 * @param {typeof INITIAL_SESSION} session
 * @param {{ type: string, identity?: object, error?: object }|undefined} event
 */
export function reduceSession(session, event) {
  switch (event?.type) {
    case 'check':
      return { ...session, error: null, checking: true };
    case 'checked':
      return { ...session, identity: event.identity ?? {}, error: null, checking: false };
    case 'check-failed':
      return { ...session, identity: null, error: event.error || { kind: 'unknown' }, checking: false };
    case 'check-cancelled':
      return { ...session, checking: false };
    case 'sign-in':
      return { ...session, error: null, signingIn: true };
    case 'signed-in':
      return {
        identity: event.identity ?? {},
        error: null,
        checking: false,
        signingIn: false,
      };
    case 'sign-in-failed':
      // A failed sign-in leaves the user signed out, except when the CLI is
      // not installed: signing in again cannot fix that.
      return {
        identity: null,
        error: event.error?.kind === 'az_missing' ? event.error : { ...NOT_SIGNED_IN },
        checking: false,
        signingIn: false,
      };
    case 'expired':
      return { ...session, identity: null, error: { ...NOT_SIGNED_IN }, checking: false };
    default:
      return session;
  }
}

/**
 * Which view the panel shows for a session state.
 * @param {typeof INITIAL_SESSION|undefined} session
 * @returns {'checking'|'signed-out'|'signing-in'|'ready'|'unavailable'}
 */
export function panelStage(session) {
  if (session?.signingIn) return 'signing-in';
  if (session?.identity) return 'ready';
  if (session?.checking) return 'checking';
  if (session?.error) return isSignedOutError(session.error) ? 'signed-out' : 'unavailable';
  return 'checking';
}

/**
 * Text for the "cannot use Azure right now" view.
 * @param {unknown} err
 * @returns {string}
 */
export function unavailableMessage(err) {
  if (err?.kind === 'az_missing') {
    return 'The Azure CLI (az) is required for Azure Key Vault. Install it, make sure it is on your PATH, then check again.';
  }
  return errorMessage(err);
}

/** Shown when a call fails because the Azure session ended while the panel was open. */
export const SESSION_EXPIRED_MESSAGE = 'Your Azure session has ended. Sign in again to continue.';

/**
 * Text for a failed sign-in. The generic "run az login" advice would be
 * circular here, so it is replaced.
 * @param {unknown} err
 * @returns {string}
 */
export function loginErrorMessage(err) {
  switch (err?.kind) {
    case 'timeout':
      return 'Sign-in did not finish in time. Try again.';
    case 'not_signed_in':
      return 'Sign-in was not completed. Try again.';
    default:
      return errorMessage(err);
  }
}

/**
 * What the non-ready views say and offer.
 * @param {'checking'|'signed-out'|'signing-in'|'ready'|'unavailable'} stage
 * @param {unknown} error the session error, used by the unavailable view
 * @returns {{ title: string, hint: string,
 *   action: { kind: 'sign-in'|'retry', label: string, disabled: boolean }|null }|null}
 */
export function stageContent(stage, error) {
  switch (stage) {
    case 'checking':
      return { title: 'Checking your Azure session…', hint: '', action: null };
    case 'signed-out':
      return {
        title: 'Sign in to Azure to browse Key Vault secrets.',
        hint: 'A browser window will open so you can finish signing in.',
        action: { kind: 'sign-in', label: 'Sign in to Azure', disabled: false },
      };
    case 'signing-in':
      return {
        title: 'Waiting for sign-in in your browser…',
        hint: 'Finish signing in in the window that opened. This can take a few minutes.',
        action: { kind: 'sign-in', label: 'Signing in…', disabled: true },
      };
    case 'unavailable':
      return {
        title: unavailableMessage(error),
        hint: '',
        action: { kind: 'retry', label: 'Check again', disabled: false },
      };
    default:
      return null;
  }
}
