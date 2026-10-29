/*
 * The set's per-icon files ship without their own types; each is one
 * component of the type its index declares.
 */
declare module '@tabler/icons-react/dist/esm/icons/*.mjs' {
  import type { TablerIcon } from '@tabler/icons-react';

  const icon: TablerIcon;
  export default icon;
}
