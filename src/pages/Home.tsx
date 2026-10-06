import { Link } from 'react-router-dom';
import { TopBar } from '../components/ui.tsx';
import { useLive } from '../lib/live.tsx';
import '../styles/home.css';

export function Home() {
  const { snap } = useLive();
  const called = snap?.active.filter((d) => d.status === 'called').length ?? 0;
  const out = snap?.active.filter((d) => d.status === 'out').length ?? 0;
  const inLine = snap?.shifts.filter((s) => s.status === 'waiting').length ?? 0;

  return (
    <>
      <TopBar station="Caddie Dispatch" />
      <main className="page home">
        <h1>Open a station</h1>
        <p className="home-lede">
          Each screen updates live. Open the Caddie House display on the TV, Bag Drop on the desk tablet, and Caddie
          Master in the caddie office.
        </p>
        <ul className="stations">
          <li>
            <Link to="/bag-drop">
              <b>Bag Drop</b>
              <span>Receive members, record bags, call caddies, close sessions when bags come back.</span>
            </Link>
          </li>
          <li>
            <Link to="/caddie-house" target="_blank">
              <b>Caddie House display</b>
              <span>Silent TV board: who is called to Bag Drop, who is next in line, who is out.</span>
            </Link>
          </li>
          <li>
            <Link to="/caddie-master">
              <b>Caddie Master</b>
              <span>Morning check-in and carts, queue order and breaks, designated caddies, reports.</span>
            </Link>
          </li>
        </ul>
        {snap && (
          <p className="home-now num">
            Right now: {called} called to Bag Drop, {out} on course, {inLine} in line.
          </p>
        )}
      </main>
    </>
  );
}
