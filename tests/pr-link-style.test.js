import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

function getRuleBody(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm'));

  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}

test('pr-link resets the default button look with dedicated success styling', () => {
  const rule = getRuleBody('.pr-link');

  assert.match(rule, /justify-self:\s*start/);
  assert.match(rule, /display:\s*inline-flex/);
  assert.match(rule, /border-color:\s*rgba\(15,\s*118,\s*110,\s*0\.2\)/);
  assert.match(rule, /background:\s*linear-gradient/);
  assert.match(rule, /color:\s*var\(--success\)/);
  assert.match(rule, /text-decoration:\s*none/);
});

test('pr-link hover and focus states stay on the dedicated style path', () => {
  const hoverRule = getRuleBody('.pr-link:hover');
  const focusRule = getRuleBody('.pr-link:focus-visible');

  assert.match(hoverRule, /border-color:\s*rgba\(15,\s*118,\s*110,\s*0\.32\)/);
  assert.match(hoverRule, /background:\s*linear-gradient/);
  assert.match(focusRule, /outline:\s*2px solid rgba\(15,\s*118,\s*110,\s*0\.25\)/);
});

test('task-timer displays elapsed time with monospace font', () => {
  const rule = getRuleBody('.task-timer');

  assert.match(rule, /font-family:/);
  assert.match(rule, /font-size:\s*12px/);
  assert.match(rule, /font-weight:\s*600/);
  assert.match(rule, /color:\s*var\(--ink-soft\)/);
  assert.match(rule, /padding:\s*4px\s*8px/);
  assert.match(rule, /border-radius:\s*6px/);
  assert.match(rule, /background:/);
});

test('task-rail-header-right groups status and timer together', () => {
  const rule = getRuleBody('.task-rail-header-right');

  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /align-items:\s*center/);
  assert.match(rule, /gap:\s*8px/);
});

test('log-box has relative positioning for copy button', () => {
  const rule = getRuleBody('.log-box');

  assert.match(rule, /position:\s*relative/);
  assert.match(rule, /overflow:\s*auto/);
  assert.match(rule, /display:\s*grid/);
});

test('log-copy-btn is sticky positioned at top right', () => {
  const rule = getRuleBody('.log-copy-btn');

  assert.match(rule, /position:\s*sticky/);
  assert.match(rule, /top:\s*0/);
  assert.match(rule, /justify-self:\s*end/);
  assert.match(rule, /z-index:\s*1/);
});

test('log-row adapts layout based on badge presence', () => {
  const rule = getRuleBody('.log-row');

  assert.match(rule, /display:\s*grid/);
  assert.match(rule, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('log-row with badge uses two-column layout', () => {
  const rule = getRuleBody('.log-row:has(.log-badge)');

  assert.match(rule, /grid-template-columns:\s*42px\s*minmax\(0,\s*1fr\)/);
  assert.match(rule, /gap:\s*8px/);
});

test('log-badge-info is hidden for cleaner output', () => {
  const rule = getRuleBody('.log-badge-info');

  assert.match(rule, /display:\s*none/);
});

test('log-thinking badge has purple accent', () => {
  const rule = getRuleBody('.log-badge-thinking');

  assert.match(rule, /color:\s*#a78bfa/);
  assert.match(rule, /background:\s*rgba\(167,\s*139,\s*250/);
});

test('log-error badge has red accent', () => {
  const rule = getRuleBody('.log-badge-error');

  assert.match(rule, /color:\s*#fca5a5/);
  assert.match(rule, /background:\s*rgba\(252,\s*165,\s*165/);
});

test('log-success badge has green accent', () => {
  const rule = getRuleBody('.log-badge-success');

  assert.match(rule, /color:\s*#86efac/);
  assert.match(rule, /background:\s*rgba\(134,\s*239,\s*172/);
});

test('log-time is subtle with muted color', () => {
  const rule = getRuleBody('.log-time');

  assert.match(rule, /color:\s*#6b7280/);
  assert.match(rule, /font-size:\s*10px/);
  assert.match(rule, /font-family:/);
});

test('log-text uses monospace with proper line-height', () => {
  const rule = getRuleBody('.log-text');

  assert.match(rule, /font-family:/);
  assert.match(rule, /font-size:\s*12px/);
  assert.match(rule, /line-height:\s*1\.4/);
  assert.match(rule, /white-space:\s*pre-wrap/);
  assert.match(rule, /word-break:\s*break-word/);
});
