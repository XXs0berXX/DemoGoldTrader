import {
  BuyGoldIcon,
  HomeIcon,
  MyGoldIcon,
  SellGoldIcon,
  WalletIcon,
} from './icons';

export type TabId = 'home' | 'wallet' | 'buy' | 'sell' | 'mygold';

const TABS: ReadonlyArray<{ id: TabId; label: string; Icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'wallet', label: 'Wallet', Icon: WalletIcon },
  { id: 'buy', label: 'Buy', Icon: BuyGoldIcon },
  { id: 'sell', label: 'Sell', Icon: SellGoldIcon },
  { id: 'mygold', label: 'My Gold', Icon: MyGoldIcon },
];

interface TabBarProps {
  active: TabId;
  onChange: (id: TabId) => void;
}

export function TabBar({ active, onChange }: TabBarProps): JSX.Element {
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className="tabbar__item"
          aria-current={active === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <Icon size={21} />
          <span className="tabbar__label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
