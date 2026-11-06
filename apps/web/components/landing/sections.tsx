import Link from 'next/link';
import { Mark } from '../ui.tsx';
import s from './landing.module.css';

export function LandingNav() {
  return (
    <nav className={`${s.nav} ${s.reveal}`} aria-label="Main">
      <Link href="/" className={s.brand}>
        <Mark />
        Quits
      </Link>
      <div className={s.links}>
        <a href="#how">How it works</a>
        <a href="#memories">Rules</a>
        <a href="#settling">Settling</a>
        <Link href="/proof">Proof</Link>
      </div>
      <Link href="/demo" className={s.navcta}>
        Open app
      </Link>
    </nav>
  );
}

const STEPS = [
  {
    title: 'Log it in plain words',
    body: 'Type it the way you’d say it. Quits reads the amount, who paid and what was in it.',
    ex: '412 zł dinner, Clara paid, 140 of it was wine',
  },
  {
    title: 'Correct it once',
    body: 'If a split is wrong, say why. That sentence becomes a rule, and every later bill follows it.',
    ex: 'I don’t drink, leave me out of the wine',
    mem: true,
  },
  {
    title: 'Settle in one tap',
    body: 'The tab nets down to the fewest payments, paid in USDC on Sui with no gas to buy.',
    ex: 'Dan → Clara · 0.50 USDC',
  },
];

export function HowItWorks() {
  return (
    <section id="how" className={s.section} aria-labelledby="how-h">
      <h2 id="how-h" className={s.h2}>
        How it works
      </h2>
      <ol className={s.steps}>
        {STEPS.map((st, i) => (
          <li key={st.title} className={s.step}>
            <span className={s.stepN}>{i + 1}</span>
            <h3>{st.title}</h3>
            <p>{st.body}</p>
            <span className={`${s.ex} ${st.mem ? s.exMem : ''}`}>{st.ex}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Memories() {
  return (
    <section id="memories" className={`${s.section} ${s.sectionGrid}`} aria-labelledby="mem-h">
      <div>
        <h2 id="mem-h" className={s.h2}>
          Memories you own
        </h2>
        <p className={s.body}>
          Every correction is saved as a Walrus Memory memory: a Sui object in the wallet of the person it’s about. A rule about you travels with
          you to every group you join, so the Lisbon trip already knows what Flat 5B learned. Keep your memories in your own Walrus Memory
          account and take them anywhere.
        </p>
      </div>
      <div className={s.obj}>
        <div className={s.objLabel}>
          <span>Memory</span>
          <span>Sui object · Walrus</span>
        </div>
        <p className={s.objTitle}>Ana doesn’t drink, so leave her out of alcohol.</p>
        <dl className={s.kv}>
          <dt>Owned by</dt>
          <dd>Ana’s wallet</dd>
          <dt>Learned</dt>
          <dd>Flat 5B, Oct 14, from one correction</dd>
          <dt>Applies in</dt>
          <dd>Flat 5B, Lisbon trip, Coffee tab</dd>
          <dt>Said as</dt>
          <dd className={s.kvMono}>I don’t drink, leave me out of the wine</dd>
        </dl>
      </div>
    </section>
  );
}

export function Settling() {
  return (
    <section id="settling" className={`${s.section} ${s.sectionGrid}`} aria-labelledby="set-h">
      <div>
        <h2 id="set-h" className={s.h2}>
          Your agent pays, within limits the chain enforces
        </h2>
        <p className={s.body}>
          Turn on auto-settle and your agent pays your debts for you, under a mandate you sign once. A Move contract on Sui checks every payment
          against it, and every open debt is an x402 and MPP payment request, so any agent that speaks either can settle it.
        </p>
      </div>
      <div className={s.obj}>
        <div className={s.objLabel}>
          <span>Mandate</span>
          <span>demo terms</span>
        </div>
        <ul className={s.clauses}>
          <li>
            <span>Only the exact debt</span>
            <span>no more, no less</span>
          </li>
          <li>
            <span>Only to people you named</span>
            <span>your group</span>
          </li>
          <li>
            <span>At most a set amount a week</span>
            <span>2 USDC</span>
          </li>
          <li>
            <span>A window to object first</span>
            <span>60 seconds</span>
          </li>
        </ul>
        <p className={s.fine}>Real members choose their own limits.</p>
      </div>
    </section>
  );
}

export function CheckEverything() {
  return (
    <section id="check" className={s.section} aria-labelledby="chk-h">
      <div className={s.check}>
        <div>
          <h2 id="chk-h" className={s.h2}>
            Check everything
          </h2>
          <p className={s.body}>The live Tatum calls, memory receipts and settlements behind the demo, each one linked to the chain.</p>
          <div className={s.checkList}>
            <span className="chip">Tatum calls</span>
            <span className="chip">Memory receipts</span>
            <span className="chip">Settlements</span>
          </div>
        </div>
        <div className={s.ctas} style={{ marginTop: 0 }}>
          <Link href="/proof" className="btn btn-ink btn-lg">
            Open the proof page
          </Link>
          <a href="#repo" className="btn btn-ghost btn-lg" data-placeholder="public-repo-url">
            Read the code
          </a>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className={s.footer}>
      <span>Quits · built on Sui, Walrus Memory and Tatum</span>
      <nav aria-label="Footer">
        <Link href="/demo">Demo</Link>
        <Link href="/proof">Proof</Link>
        <a href="#repo" data-placeholder="public-repo-url">
          Code
        </a>
      </nav>
    </footer>
  );
}
