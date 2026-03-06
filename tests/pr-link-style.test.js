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
