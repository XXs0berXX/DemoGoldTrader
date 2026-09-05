import { useCallback, useEffect, useState } from 'react';
import { AppBar } from './components/AppBar';
import { DemoPanel } from './components/DemoPanel';
import { TabBar, type TabId } from './components/TabBar';
import { SlidersIcon } from './components/icons';
import { HomeScreen } from './screens/HomeScreen';
import { MyGoldScreen } from './screens/MyGoldScreen';
import { TradeFlow } from './screens/TradeFlow';
import { WalletScreen } from './screens/WalletScreen';
import { AppDataProvider } from './state/AppDataProvider';

const TAB_TITLES: Record<TabId, string> = {
  home: 'Home',
  wallet: 'Top Up',
  buy: 'Buy Gold',
  sell: 'Sell Gold',
  mygold: 'My Gold',
};

const TAB_IDS: readonly TabId[] = ['home', 'wallet', 'buy', 'sell', 'mygold'];

function readHash(): { tab: TabId; demo: boolean } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (raw === 'demo') return { tab: 'home', demo: true };
  const tab = TAB_IDS.find((t) => t === raw);
  return { tab: tab ?? 'home', demo: false };
}

/**
 * Hash routing rather than history routing: the built bundle is served from the
 * backend at the site root with no SPA rewrite rule, so a deep link like
 * `#/demo` has to survive a hard refresh without server configuration.
 */
function Shell(): JSX.Element {
  const initial = readHash();
  const [tab, setTab] = useState<TabId>(initial.tab);
  const [demoOpen, setDemoOpen] = useState(initial.demo);

  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      setTab(next.tab);
      if (next.demo) setDemoOpen(true);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: TabId) => {
    setTab(next);
    if (window.location.hash !== `#/${next}`) {
      window.location.hash = `#/${next}`;
    }
  }, []);

  const isTrade = tab === 'buy' || tab === 'sell';

  return (
    <div className="shell">
      <div className="shell__phone">
        {isTrade ? (
          // Keyed by side so switching Buy <-> Sell starts a clean flow rather
          // than carrying a quote for the wrong direction across.
          <TradeFlow
            key={tab}
            side={tab === 'buy' ? 'BUY' : 'SELL'}
            onExit={() => navigate('home')}
          />
        ) : (
          <>
            <AppBar title={TAB_TITLES[tab]} />
            {tab === 'home' ? <HomeScreen onNavigate={navigate} /> : null}
            {tab === 'wallet' ? <WalletScreen /> : null}
            {tab === 'mygold' ? <MyGoldScreen /> : null}
          </>
        )}

        <TabBar active={tab} onChange={navigate} />

        <button
          type="button"
          className="demolaunch"
          onClick={() => setDemoOpen(true)}
          aria-haspopup="dialog"
        >
          <SlidersIcon />
          Demo controls
        </button>

        <DemoPanel open={demoOpen} onClose={() => setDemoOpen(false)} />
      </div>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  );
}
