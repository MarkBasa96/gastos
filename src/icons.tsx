import {
  Banknote,
  Briefcase,
  Bus,
  Coins,
  CreditCard,
  Ellipsis,
  Gift,
  HeartPulse,
  Landmark,
  Laptop,
  PartyPopper,
  Receipt,
  Send,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Tag,
  Utensils,
  Wallet,
  type LucideIcon,
} from './lucide';
import type { PayGroup } from './data';

// Legacy v1 categories (Groceries, Fun) keep an icon so old entries still look right.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Food: Utensils,
  Transport: Bus,
  Load: Smartphone,
  Bills: Receipt,
  Padala: Send,
  Shopping: ShoppingBag,
  Health: HeartPulse,
  Other: Ellipsis,
  Groceries: ShoppingCart,
  Fun: PartyPopper,
  Salary: Briefcase,
  Freelance: Laptop,
  Gift: Gift,
  'Other income': Coins,
};

export function categoryIcon(c: string): LucideIcon {
  return CATEGORY_ICONS[c] ?? Tag;
}

const LANDMARK_NAMES = /bank|gotyme|maribank|tonik|cimb|uno|ing|komo|diskartech/i;

export function payIcon(name: string, group: PayGroup): LucideIcon {
  if (group === 'cash') return Banknote;
  if (group === 'card') return CreditCard;
  return LANDMARK_NAMES.test(name) ? Landmark : Wallet;
}
