import { buildTree } from '../tools/tree.js';
import { computeStatsFromValue } from '../tools/stats.js';
import { queryJson } from '../tools/query.js';
import { diffJson, describeDiff } from '../tools/diff.js';
import { jsonToYaml, yamlToJson, jsonToCsv } from '../tools/convert.js';
import { formatBytes } from '../tools/jsonUtils.js';

/**
 * Wire up the right-hand tabbed panel: Tree / Query / Diff / Convert / Stats.
 * @param {{ tabsEl: HTMLElement, panelsEl: HTMLElement, onCopyPath: (path: string) => void, onNotify: (msg: string, kind?: string) => void }} refs
 */
export function initRightPanel({ tabsEl, panelsEl, onCopyPath, onNotify }) {
  const tabs = [...tabsEl.querySelectorAll('.tab')];
  const panels = {};
  for (const panel of panelsEl.querySelectorAll('.tab-panel')) {
    panels[panel.dataset.panel] = panel;
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      Object.values(panels).forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      panels[tab.dataset.tab]?.classList.add('active');
    });
  });

  /**
   * Render one tree row. Object/array nodes only materialize their own
   * children's DOM the first time they are expanded (and hide, rather
   * than destroy, on collapse) — this is what keeps a large document
   * from freezing the UI: `buildTree` already defers building the
   * underlying node graph per level, and this defers the DOM to match.
   * `isRoot` renders the top level pre-expanded so the immediate shape
   * of the document is visible right away, matching prior behavior;
   * everything below that materializes on demand.
   */
  function renderTreeNode(node, isRoot = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

    const row = document.createElement('div');
    row.className = 'tree-node__row';

    const isContainer = node.type === 'object' || node.type === 'array';
    const childCount = isContainer ? node.children.length : 0;

    const toggle = document.createElement('span');
    toggle.className = 'tree-node__toggle';
    // A single glyph that rotates via CSS on expand/collapse (see
    // .tree-node__toggle--expanded), rather than swapping between two
    // different characters — that's what lets the rotation animate.
    toggle.textContent = childCount > 0 ? '▸' : '';

    const keyEl = document.createElement('span');
    keyEl.className = 'tree-node__key';
    keyEl.textContent = node.key;

    const typeEl = document.createElement('span');
    typeEl.className = 'tree-node__type';
    typeEl.textContent = node.type;

    row.appendChild(toggle);
    row.appendChild(keyEl);
    row.appendChild(typeEl);

    // `gridWrap` is the always-present (but empty until first expand)
    // animation wrapper; `childrenContainer` is the actual child DOM,
    // still built lazily on first expand only — this split is what keeps
    // the CSS grid-rows expand/collapse animation from requiring the
    // children to exist (or be measured) up front.
    let gridWrap = null;
    let childrenContainer = null;
    let expanded = false;

    function ensureGridWrap() {
      if (gridWrap) return;
      gridWrap = document.createElement('div');
      gridWrap.className = 'tree-node__children-grid';
      wrapper.appendChild(gridWrap);
    }

    function buildChildrenDom() {
      childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-node__children';
      for (const child of node.children) {
        childrenContainer.appendChild(renderTreeNode(child));
      }
      ensureGridWrap();
      gridWrap.appendChild(childrenContainer);
    }

    function setExpanded(next) {
      const isFirstExpand = next && !childrenContainer;
      if (isFirstExpand) buildChildrenDom();
      expanded = next;
      ensureGridWrap();
      if (isFirstExpand) {
        // The grid wrapper was only just attached above: force a reflow so
        // its collapsed (0fr) state is committed before switching to
        // expanded, otherwise both changes land in the same frame and the
        // browser has nothing to transition from.
        void gridWrap.offsetHeight;
      }
      gridWrap.classList.toggle('tree-node__children-grid--expanded', expanded);
      toggle.classList.toggle('tree-node__toggle--expanded', expanded);
    }

    if (!isContainer) {
      const valueEl = document.createElement('span');
      valueEl.className = 'tree-node__value';
      valueEl.textContent = JSON.stringify(node.value);
      row.appendChild(valueEl);
    } else if (childCount > 0) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        setExpanded(!expanded);
      });
    }

    row.title = `Click to copy path: ${node.path}`;
    row.addEventListener('click', (e) => {
      if (isContainer) return; // handled above (toggle); leaves copy on click too
      e.stopPropagation();
      onCopyPath?.(node.path);
    });
    if (isContainer) {
      keyEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        onCopyPath?.(node.path);
      });
    }

    wrapper.appendChild(row);
    if (isRoot && childCount > 0) setExpanded(true);
    return wrapper;
  }

  /**
   * @param {string} text
   * @param {{ valid: true, value: * } | { valid: false, error: { message: string } }} [parseResult]
   *   Already-parsed document, shared with validation/stats for this
   *   refresh cycle so the tree does not re-parse `text` on its own.
   */
  function renderTree(text, parseResult) {
    const panel = panels.tree;
    panel.innerHTML = '';
    if (!text || text.trim() === '') {
      panel.textContent = 'Nothing to show yet.';
      return;
    }
    if (!parseResult || !parseResult.valid) {
      const message = parseResult?.error?.message ?? 'Invalid JSON';
      panel.textContent = `Cannot build tree: ${message}`;
      return;
    }
    try {
      const tree = buildTree(parseResult.value);
      panel.appendChild(renderTreeNode(tree, true));
    } catch (err) {
      panel.textContent = `Cannot build tree: ${err.message}`;
    }
  }

  /**
   * @param {string} text
   * @param {{ valid: true, value: * } | { valid: false, error: { message: string } }} [parseResult]
   *   Already-parsed document, shared with validation/tree for this
   *   refresh cycle so stats do not re-parse `text` on their own.
   */
  function renderStats(text, parseResult) {
    const panel = panels.stats;
    panel.innerHTML = '';
    if (!text || text.trim() === '') {
      panel.textContent = 'Nothing to show yet.';
      return;
    }
    if (!parseResult || !parseResult.valid) {
      const message = parseResult?.error?.message ?? 'Invalid JSON';
      panel.textContent = `Cannot compute stats: ${message}`;
      return;
    }
    try {
      const stats = computeStatsFromValue(parseResult.value, text);
      const grid = document.createElement('div');
      grid.className = 'stats-grid';
      const tiles = [
        ['Byte size', formatBytes(stats.byteSize)],
        ['Lines', stats.lineCount],
        ['Max depth', stats.maxDepth],
        ['Total keys', stats.totalKeys],
        ['Arrays', stats.arrayCount],
      ];
      for (const [label, value] of tiles) {
        const tile = document.createElement('div');
        tile.className = 'stats-tile';
        const labelEl = document.createElement('span');
        labelEl.className = 'stats-tile__label';
        labelEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.className = 'stats-tile__value';
        valueEl.textContent = String(value);
        tile.appendChild(labelEl);
        tile.appendChild(valueEl);
        grid.appendChild(tile);
      }
      panel.appendChild(grid);

      const histogram = document.createElement('div');
      histogram.className = 'stats-histogram';

      const histTitle = document.createElement('div');
      histTitle.className = 'stats-histogram__title';
      histTitle.textContent = 'Type histogram';
      histogram.appendChild(histTitle);

      const list = document.createElement('div');
      list.className = 'stats-histogram__list';
      const counts = Object.values(stats.typeHistogram);
      const maxCount = Math.max(1, ...counts);
      for (const [type, count] of Object.entries(stats.typeHistogram)) {
        const row = document.createElement('div');
        row.className = 'stats-histogram__row';
        if (count === 0) row.classList.add('stats-histogram__row--zero');

        const labelEl = document.createElement('span');
        labelEl.className = 'stats-histogram__label';
        labelEl.textContent = type;

        const barTrack = document.createElement('div');
        barTrack.className = 'stats-histogram__bar-track';
        const bar = document.createElement('div');
        bar.className = 'stats-histogram__bar';
        const percent = count > 0 ? (count / maxCount) * 100 : 0;
        bar.style.setProperty('--bar-percent', `${percent}%`);
        barTrack.appendChild(bar);

        const countEl = document.createElement('span');
        countEl.className = 'stats-histogram__count';
        countEl.textContent = String(count);

        row.appendChild(labelEl);
        row.appendChild(barTrack);
        row.appendChild(countEl);
        list.appendChild(row);
      }
      histogram.appendChild(list);
      panel.appendChild(histogram);
    } catch (err) {
      panel.textContent = `Cannot compute stats: ${err.message}`;
    }
  }

  let queryPanelBuilt = false;
  function renderQuery(getText) {
    const panel = panels.query;
    if (!queryPanelBuilt) {
      panel.innerHTML = '';
      const input = document.createElement('input');
      input.className = 'query-input';
      input.type = 'text';
      input.placeholder = 'JSONPath, e.g. $.store.book[*].author';
      const results = document.createElement('div');
      results.className = 'query-results';
      const run = () => {
        const expr = input.value.trim();
        if (!expr) {
          results.textContent = '';
          return;
        }
        try {
          const parsed = JSON.parse(getText());
          const matches = queryJson(parsed, expr);
          results.textContent = JSON.stringify(
            matches.map((m) => ({ path: m.path, value: m.value })),
            null,
            2
          );
        } catch (err) {
          results.textContent = `Error: ${err.message}`;
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') run();
      });
      panel.appendChild(input);
      panel.appendChild(results);
      queryPanelBuilt = true;
    }
  }

  let convertPanelBuilt = false;
  function renderConvert(getText) {
    const panel = panels.convert;
    if (convertPanelBuilt) return;
    panel.innerHTML = '';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '6px';
    buttons.style.marginBottom = '8px';
    buttons.style.flexWrap = 'wrap';

    const output = document.createElement('pre');
    output.className = 'query-results';
    output.style.whiteSpace = 'pre-wrap';

    const actions = [
      ['JSON → YAML', () => jsonToYaml(getText())],
      ['JSON → CSV', () => jsonToCsv(getText())],
      ['YAML → JSON', () => yamlToJson(getText())],
    ];

    for (const [label, fn] of actions) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        try {
          output.textContent = fn();
        } catch (err) {
          onNotify?.(`Conversion failed: ${err.message}`, 'error');
        }
      });
      buttons.appendChild(btn);
    }

    panel.appendChild(buttons);
    panel.appendChild(output);
    convertPanelBuilt = true;
  }

  function renderDiff(leftText, rightText) {
    const panel = panels.diff;
    panel.innerHTML = '';
    try {
      const left = JSON.parse(leftText || 'null');
      const right = JSON.parse(rightText || 'null');
      const delta = diffJson(left, right);
      const changes = describeDiff(delta);
      if (changes.length === 0) {
        panel.textContent = 'No differences.';
        return;
      }
      const list = document.createElement('div');
      list.className = 'diff-list';
      for (const change of changes) {
        const entry = document.createElement('div');
        const entryKind =
          change.kind === 'modified' ? 'modified' :
          change.kind === 'added' ? 'added' :
          change.kind === 'moved' ? 'moved' :
          'removed';
        entry.className = `diff-entry diff-entry--${entryKind}`;
        const pathEl = document.createElement('span');
        pathEl.className = 'diff-entry__path';
        pathEl.textContent = change.path;
        const bodyEl = document.createElement('span');
        if (change.kind === 'added') {
          bodyEl.textContent = `+ ${JSON.stringify(change.newValue)}`;
        } else if (change.kind === 'removed') {
          bodyEl.textContent = `- ${JSON.stringify(change.oldValue)}`;
        } else if (change.kind === 'moved') {
          bodyEl.textContent = `moved to index ${change.toIndex}`;
        } else {
          bodyEl.textContent = `${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`;
        }
        entry.appendChild(pathEl);
        entry.appendChild(bodyEl);
        list.appendChild(entry);
      }
      panel.appendChild(list);
    } catch (err) {
      panel.textContent = `Cannot compute diff: ${err.message}`;
    }
  }

  return { renderTree, renderStats, renderQuery, renderConvert, renderDiff };
}
