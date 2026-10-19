// Explicit named re-exports and a namespace re-export are not wildcard barrels.
export { Button, type ButtonProps } from './Button';
export * as icons from './icons';
export { default as Modal } from './Modal';
// export * from './commented-out';
const doc = "export * from './in-string'";
const tpl = `export * from './in-template'`;
// Direct sibling imports are what the fix produces; look-alike specifiers are not barrels.
import { Avatar } from '../avatar/Avatar';
import { helper } from './index-helpers';
import { slug } from '../indexer';
import data from '../index.json';
import { x } from './dot.';
export const keep = [Avatar, helper, slug, data, x, doc, tpl];
