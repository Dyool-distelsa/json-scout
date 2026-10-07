import { el, button } from './dom.js';
import { readBuildInfo } from './buildTag.js';
import { SHORTCUTS, formatShortcut, detectMac } from './shortcuts.js';

export const REPO_URL = 'https://github.com/Dyool-distelsa/json-scout';
export const ISSUES_URL = `${REPO_URL}/issues`;
export const AUTHOR = 'Dylan Yool';

const KNOWN = (value) => typeof value === 'string' && value.trim() !== '' && value !== 'unknown';

/**
 * Version facts for display, from the build constants.
 * @param {import('./buildTag.js').BuildInfo} info
 * @returns {Array<[string, string]>}
 */
export function versionRows(info = {}) {
  const rows = [['Version', KNOWN(info.version) ? info.version : 'dev']];
  const commit = KNOWN(info.commitFull) ? info.commitFull : info.commit;
  if (KNOWN(commit)) rows.push(['Commit', commit]);
  if (KNOWN(info.date)) rows.push(['Built', info.date]);
  return rows;
}

/** Open `url` in the system browser (desktop app) or a new tab. */
async function openExternal(url, isTauri) {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

function section(title) {
  const node = el('section', 'help-section');
  node.appendChild(el('h3', 'help-section__title', title));
  return node;
}

function code(text) {
  return el('code', 'help-code', text);
}

/**
 * Render the Help panel: version, repository, how to contribute, shortcuts
 * and credits.
 * @param {HTMLElement} container
 * @param {{ isTauri: boolean, notify: (message: string, kind?: string) => void }} deps
 */
export function createHelpPanel(container, { isTauri, notify }) {
  container.replaceChildren();
  const root = el('div', 'help-panel');

  function link(label, url) {
    const node = el('a', 'help-link', label);
    node.href = url;
    node.addEventListener('click', (event) => {
      event.preventDefault();
      openExternal(url, isTauri).catch(() => notify('Could not open the browser.', 'error'));
    });
    return node;
  }

  // About
  const about = section('JSON Scout');
  about.appendChild(
    el('p', 'help-text', 'A fast desktop JSON viewer and editor with optional Azure Key Vault sync.')
  );
  const facts = el('dl', 'help-facts');
  for (const [term, value] of versionRows(readBuildInfo())) {
    facts.append(el('dt', undefined, term), el('dd', 'help-mono', value));
  }
  about.appendChild(facts);

  // Repository
  const repo = section('Repository');
  const repoRow = el('div', 'help-row');
  repoRow.append(
    link(REPO_URL.replace('https://', ''), REPO_URL),
    button('Copy', 'vault-btn', async () => {
      try {
        await navigator.clipboard.writeText(REPO_URL);
        notify('Repository link copied.', 'success');
      } catch {
        notify('Could not copy to clipboard.', 'error');
      }
    })
  );
  repo.appendChild(repoRow);
  const issues = el('p', 'help-text');
  issues.append('Found a bug or have an idea? ', link('Open an issue', ISSUES_URL), '.');
  repo.appendChild(issues);

  // Contributing
  const contrib = section('Contributing');
  const steps = el('ol', 'help-steps');
  const step = (...parts) => {
    const item = el('li');
    item.append(...parts);
    steps.appendChild(item);
  };
  step('Fork the repository and create a branch such as ', code('feat/my-change'), '.');
  step('Install and run: ', code('npm install'), ' then ', code('npm run tauri dev'), '.');
  step('Add tests with the change: ', code('npm test'), ' and ', code('cargo test'), ' in ', code('src-tauri'), '.');
  step('Use Conventional Commits, e.g. ', code('fix(query): …'), '.');
  step('Open a pull request against ', code('main'), ' describing what changed and how you tested it.');
  contrib.appendChild(steps);

  // Shortcuts
  const keys = section('Keyboard shortcuts');
  const isMac = detectMac();
  const table = el('dl', 'help-facts help-facts--keys');
  for (const shortcut of SHORTCUTS) {
    table.append(
      el('dt', undefined, shortcut.label),
      el('dd', 'help-mono', formatShortcut(shortcut.action, isMac))
    );
  }
  keys.appendChild(table);

  // Credits
  const credits = section('Credits');
  credits.appendChild(el('p', 'help-text', `Created and maintained by ${AUTHOR}, owner of the repository.`));
  credits.appendChild(el('p', 'help-text help-text--dim', 'Released under the MIT License.'));

  root.append(about, credits, repo, contrib, keys);
  container.appendChild(root);
}
