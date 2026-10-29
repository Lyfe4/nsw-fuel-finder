/*
 * Every icon in the app, from one set: Tabler Icons (MIT), outline on a 24
 * px grid with a 2 px round stroke, the weight of Atkinson's bold labels
 * (docs/design-system.md, Icons). Imported one file each, so the build
 * holds only these and the tests never load the set's 6,000-icon index.
 * Nothing else imports @tabler/icons-react (eslint.config.js).
 *
 * Named by job, not by shape, so a swap is one line here.
 */
export { default as ArrowDown } from '@tabler/icons-react/dist/esm/icons/IconArrowDown.mjs';
export { default as ArrowUp } from '@tabler/icons-react/dist/esm/icons/IconArrowUp.mjs';
export { default as Back } from '@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs';
export { default as Caret } from '@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs';
export { default as Close } from '@tabler/icons-react/dist/esm/icons/IconX.mjs';
export { default as Disclosure } from '@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs';
export { default as NewTab } from '@tabler/icons-react/dist/esm/icons/IconArrowUpRight.mjs';
export { default as Search } from '@tabler/icons-react/dist/esm/icons/IconSearch.mjs';
export { default as Star } from '@tabler/icons-react/dist/esm/icons/IconStar.mjs';
export { default as StarFilled } from '@tabler/icons-react/dist/esm/icons/IconStarFilled.mjs';
export { default as ZoomIn } from '@tabler/icons-react/dist/esm/icons/IconPlus.mjs';
export { default as ZoomOut } from '@tabler/icons-react/dist/esm/icons/IconMinus.mjs';
