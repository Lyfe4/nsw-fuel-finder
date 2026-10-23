import axe, { type AxeResults, type ElementContext, type RunOptions } from 'axe-core';
import { expect } from 'vitest';

/*
 * Mirrors Patchbay's helper (src/lib/testing/axe.ts there): axe-core called
 * directly rather than through a matcher package, so there is one dependency
 * and its version is ours to pin.
 */

/**
 * jsdom has no layout engine, so it has no computed colours: contrast is
 * checked on the tokens instead (src/styles/tokens.test.ts).
 */
const JSDOM_UNSUPPORTED_RULES: RunOptions = {
  rules: { 'color-contrast': { enabled: false } },
};

function formatViolations(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => `    at ${node.target.join(', ')}`).join('\n');
      return `  [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n${targets}`;
    })
    .join('\n\n');
}

/** Asserts that a rendered subtree has no axe-core violations. */
export async function expectNoAxeViolations(
  context: ElementContext,
  options?: RunOptions,
): Promise<void> {
  const results = await axe.run(context, { ...JSDOM_UNSUPPORTED_RULES, ...options });
  expect(
    results.violations,
    results.violations.length > 0
      ? `Accessibility violations found:\n\n${formatViolations(results)}`
      : undefined,
  ).toHaveLength(0);
}
