// A module in src/components/cards reaching a sibling through its own directory barrel.
import { Avatar } from '../index';
import type { Props } from '.';
import {
  Button,
  Icon,
} from './index';
import Default, { Tag } from './index.ts';
import { Modal } from '..';
export const used = [Avatar, Button, Icon, Default, Tag, Modal];
export type P = Props;
