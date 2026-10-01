import { describe, it, expect } from 'vitest';
import {
  SIDEBAR_TABS,
  visibleSidebarTabs,
  resolveSidebarTab,
  sidebarTabLabel,
  moveSidebarTab,
} from './sidebarTabs.js';

describe('SIDEBAR_TABS', () => {
  it('lists Files first, then Vault, which belongs to the vault plugin', () => {
    expect(SIDEBAR_TABS.map((tab) => tab.id)).toEqual(['files', 'vault']);
    expect(SIDEBAR_TABS.find((tab) => tab.id === 'vault')?.plugin).toBe('vault');
    expect(SIDEBAR_TABS.find((tab) => tab.id === 'files')?.plugin).toBeNull();
  });
});

describe('visibleSidebarTabs', () => {
  it('shows only Files while no plugin is active', () => {
    expect(visibleSidebarTabs(() => false)).toEqual(['files']);
  });

  it('adds Vault while the vault plugin is active', () => {
    expect(visibleSidebarTabs((id) => id === 'vault')).toEqual(['files', 'vault']);
  });

  it('asks about plugins by id and never about Files', () => {
    const asked = [];
    visibleSidebarTabs((id) => {
      asked.push(id);
      return true;
    });
    expect(asked).toEqual(['vault']);
  });

  it('tolerates a missing predicate', () => {
    expect(visibleSidebarTabs(undefined)).toEqual(['files']);
  });
});

describe('resolveSidebarTab', () => {
  it('keeps a requested tab that is visible', () => {
    expect(resolveSidebarTab('vault', ['files', 'vault'])).toBe('vault');
    expect(resolveSidebarTab('files', ['files', 'vault'])).toBe('files');
  });

  it('falls back to Files when the requested tab is hidden', () => {
    expect(resolveSidebarTab('vault', ['files'])).toBe('files');
  });

  it('falls back to Files for an unknown or missing request', () => {
    expect(resolveSidebarTab('nope', ['files', 'vault'])).toBe('files');
    expect(resolveSidebarTab(undefined, ['files', 'vault'])).toBe('files');
  });
});

describe('sidebarTabLabel', () => {
  it('names the tabs for the collapse button and the rail', () => {
    expect(sidebarTabLabel('files')).toBe('Files');
    expect(sidebarTabLabel('vault')).toBe('Vault');
  });

  it('falls back to Files for an unknown tab', () => {
    expect(sidebarTabLabel('nope')).toBe('Files');
    expect(sidebarTabLabel(undefined)).toBe('Files');
  });
});

describe('moveSidebarTab', () => {
  const both = ['files', 'vault'];

  it('moves right and left with wrap-around', () => {
    expect(moveSidebarTab('files', both, 'ArrowRight')).toBe('vault');
    expect(moveSidebarTab('vault', both, 'ArrowRight')).toBe('files');
    expect(moveSidebarTab('files', both, 'ArrowLeft')).toBe('vault');
    expect(moveSidebarTab('vault', both, 'ArrowLeft')).toBe('files');
  });

  it('jumps to the ends with Home and End', () => {
    expect(moveSidebarTab('vault', both, 'Home')).toBe('files');
    expect(moveSidebarTab('files', both, 'End')).toBe('vault');
  });

  it('stays put for other keys or a single visible tab', () => {
    expect(moveSidebarTab('files', both, 'a')).toBe('files');
    expect(moveSidebarTab('files', ['files'], 'ArrowRight')).toBe('files');
  });

  it('starts from Files when the current tab is not visible', () => {
    expect(moveSidebarTab('vault', ['files'], 'ArrowRight')).toBe('files');
  });
});
