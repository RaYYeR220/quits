'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BEAT_COUNT, GROUPS, STILL, beatAt, fmt, type Card, type Cur, type Owed, type Row, type Why } from './beats.ts';
import s from './landing.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

function useReducedMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(m.matches);
    const on = () => setReduce(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** Types `text` out once after `delay`, on the clock (so it never drifts from the beat's schedule). */
function Typed({ text, speed, delay, instant }: { text: string; speed: number; delay: number; instant: boolean }) {
  const whole = instant || speed === 0;
  const [n, setN] = useState(whole ? text.length : 0);
  useEffect(() => {
    if (whole) {
      setN(text.length);
      return;
    }
    // when each character is due, in ms after the start (commas pause a little)
    const due: number[] = [];
    let at = delay;
    for (let i = 0; i < text.length; i++) {
      at += speed + (i > 0 && text[i - 1] === ',' ? 90 : 0);
      due.push(at);
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const el = t - t0;
      let k = 0;
      while (k < due.length && (due[k] ?? Infinity) <= el) k++;
      setN(k);
      if (k < text.length) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, speed, delay, whole]);
  return <>{text.slice(0, n)}</>;
}

/** A figure that rolls from its previous value to the new one. */
function Amount({ v, cur, signed, instant, className }: { v: number | null; cur: Cur; signed: boolean; instant: boolean; className?: string }) {
  const [shown, setShown] = useState(v);
  const from = useRef<number | null>(v);
  useEffect(() => {
    if (v === null || instant) {
      from.current = v;
      setShown(v);
      return;
    }
    const a = from.current ?? 0;
    const t0 = performance.now();
    let raf = 0;
    const st = (t: number) => {
      const p = Math.min(1, (t - t0) / 850);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setShown(a + (v - a) * e);
      if (p < 1) raf = requestAnimationFrame(st);
      else from.current = v;
    };
    raf = requestAnimationFrame(st);
    return () => {
      cancelAnimationFrame(raf);
      from.current = v;
    };
  }, [v, instant]);
  return <span className={className}>{shown === null ? '—' : fmt(shown, cur, signed)}</span>;
}

function Countdown({ seconds, instant }: { seconds: number; instant: boolean }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (instant) return;
    const t0 = Date.now();
    const t = setInterval(() => setLeft(Math.max(0, seconds - Math.floor((Date.now() - t0) / 1000))), 250);
    return () => clearInterval(t);
  }, [seconds, instant]);
  return <b>{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</b>;
}

function Check() {
  return (
    <span className={s.ck} aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6.3l2.2 2.2L9.5 3.7" stroke="#b9a8ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function WhyLayer({ w, instant }: { w: Why; instant: boolean }) {
  switch (w.kind) {
    case 'quiet':
      return <span className={s.quiet}>{w.text}</span>;
    case 'learned':
      return (
        <span className={cx(s.pill, s.learned)} data-tip>
          <i>{w.date}</i>
          {w.text}
        </span>
      );
    case 'group':
      return (
        <span className={cx(s.pill, s.group)} data-tip>
          <span className={s.gm}>{w.mark}</span>
          <i>{w.date}</i>
          {w.text}
        </span>
      );
    case 'port':
      return (
        <span className={cx(s.pill, s.port)} data-tip>
          <span className={s.pa}>A</span>
          <span className={s.portTx}>
            <small>{w.small}</small>
            {w.text}
          </span>
        </span>
      );
    case 'once':
      return (
        <span className={cx(s.pill, s.once)} data-tip>
          <i>this bill</i>
          {w.text}
        </span>
      );
    case 'receipt':
      return (
        <span className={s.receipt} data-tip>
          <Check />
          {w.text}
          {w.digest ? (
            <span className={s.dig} data-placeholder="tx-digest">
              {w.digest}
            </span>
          ) : null}
        </span>
      );
    case 'agent':
      return (
        <span className={s.agent}>
          <span className={cx(s.pill, s.group)} data-tip>
            <span className={s.gm}>A</span>
            Ana’s agent pays this
          </span>
          <span className={s.count}>
            <Countdown seconds={w.seconds} instant={instant} />
            <small>left to object</small>
          </span>
        </span>
      );
    case 'teach':
      return null;
  }
}

/** Keeps the outgoing layer for a beat so the reason slot crossfades instead of cutting. */
function WhySlot({ why, k, instant }: { why: Why | null; k: number; instant: boolean }) {
  const [out, setOut] = useState<{ k: number; w: Why } | null>(null);
  const last = useRef<{ k: number; w: Why | null }>({ k, w: why });
  useEffect(() => {
    if (last.current.k === k) {
      last.current.w = why;
      return;
    }
    const prev = last.current.w;
    setOut(prev && !instant ? { k: last.current.k, w: prev } : null);
    last.current = { k, w: why };
    const t = setTimeout(() => setOut(null), 420);
    return () => clearTimeout(t);
  }, [k, why, instant]);

  return (
    <div className={s.why}>
      {out && out.w.kind !== 'teach' ? (
        <div key={`o${out.k}`} className={cx(s.layer, s.leaving)} aria-hidden="true">
          <WhyLayer w={out.w} instant />
        </div>
      ) : null}
      {why?.kind === 'teach' ? (
        <div key={`t${k}`} className={cx(s.teach, why.neutral && s.teachNeutral)}>
          <small>{why.label}</small>
          <div>
            <Typed text={why.text} speed={why.speed} delay={0} instant={instant} />
          </div>
        </div>
      ) : why ? (
        <div key={`n${k}`} className={cx(s.layer, why.kind === 'port' && why.travel && !instant && s.travel)}>
          <WhyLayer w={why} instant={instant} />
        </div>
      ) : null}
    </div>
  );
}

function OwedLine({ o }: { o: Owed | null }) {
  if (!o) return <span />;
  return (
    <span className={cx(s.owed, o.big && s.owedBig)}>
      {o.pre}
      {o.bold ? <b>{o.bold}</b> : null}
    </span>
  );
}

function Headline({ tail, instant }: { tail: string; instant: boolean }) {
  const [shown, setShown] = useState(tail);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (tail === shown) return;
    if (instant) {
      setShown(tail);
      return;
    }
    setFading(true);
    const t = setTimeout(() => {
      setShown(tail);
      setFading(false);
    }, 240);
    return () => clearTimeout(t);
  }, [tail, shown, instant]);
  return (
    <h1 className={cx(s.h1, s.reveal, s.d1)}>
      Tell it once <span className={cx(s.rot, fading && s.rotOut)}>{shown}</span>
    </h1>
  );
}

function BillCard({ c, beat, instant, onNext }: { c: Card; beat: number; instant: boolean; onNext: () => void }) {
  const g = GROUPS[c.group];
  const [tipOn, setTipOn] = useState(false);
  const tipTarget = (e: React.SyntheticEvent) => (e.target as HTMLElement).closest('[data-tip]');
  return (
    <div
      className={cx(s.card, s.reveal, s.d4)}
      role="group"
      aria-roledescription="product preview"
      aria-label="A Quits bill card: a bill is split, corrected once, remembered, applied in another group, settled in USDC, paid by an agent and fixed once without learning."
      onClick={(e) => {
        if (tipTarget(e)) {
          setTipOn((v) => !v);
          return;
        }
        onNext();
      }}
      onMouseOver={(e) => setTipOn(Boolean(tipTarget(e)) && Boolean(c.tip))}
      onMouseLeave={() => setTipOn(false)}
    >
      <div className={s.hd}>
        <div key={c.group} className={s.grp}>
          <i className={s.gmark} style={{ fontStyle: 'normal' }}>
            {g.mark}
          </i>
          <div>
            {g.name}
            <small>{g.meta}</small>
          </div>
        </div>
        <span className={cx(s.when, c.whenOn && s.whenOn)}>{c.when}</span>
      </div>
      <div className={s.panel}>
        <div className={cx(s.trail, c.trail && s.trailOn)} />
        <div className={s.top}>
          <div className={cx(s.layerTop, c.view !== 'compose' && s.hidden)}>
            <div className={s.composer} data-placeholder={c.illustrative}>
              <Typed key={c.typeKey} text={c.text} speed={c.typeSpeed} delay={c.typeDelay} instant={instant} />
              <span className={s.caret} />
            </div>
            <div key={c.chipsKey} className={s.chips}>
              {c.chips.map((ch, j) => (
                <span key={ch.label} className={cx(s.tchip, ch.tag && s.tchipTag)} style={{ animationDelay: `${j * 120}ms` }}>
                  {ch.label}
                </span>
              ))}
            </div>
          </div>
          <div className={cx(s.layerTop, c.view !== 'tab' && s.hidden)}>
            <span className={s.tabSmall}>{c.tab.small}</span>
            <span className={s.tabBig}>{c.tab.big}</span>
            <span className={s.tabLine}>{c.tab.line}</span>
          </div>
        </div>
        <div key={c.group} className={s.rows}>
          {c.rows.map((r: Row, k) => (
            <div key={r.name} className={cx(s.row, r.dim && s.dim)}>
              <span className={cx(s.av, c.avOn === k && s.avOn)}>{r.name[0]}</span>
              <div className={s.who}>
                <b>{r.name}</b>
                <span className={cx(s.note, r.mem && r.note && s.noteMem)}>{r.note}</span>
              </div>
              <Amount v={r.v} cur={c.cur} signed={c.signed} instant={instant} className={cx(s.amt, r.mem && s.amtMem, r.dim && s.amtZero)} />
            </div>
          ))}
        </div>
        <WhySlot why={c.why} k={c.whyKey} instant={instant} />
        <div className={cx(s.tip, tipOn && c.tip && s.tipOn)} aria-hidden={!tipOn}>
          {c.tip}
        </div>
      </div>
      <div className={s.ft}>
        <OwedLine key={c.owedKey} o={c.owed} />
        <div className={s.acts}>
          {c.actA ? <span className={cx(s.act, c.pressA && s.actPress)}>{c.actA}</span> : null}
          {c.actB ? <span className={cx(s.act, s.actPrimary, c.pressB && s.actPress)}>{c.actB}</span> : null}
        </div>
      </div>
      <div className={s.beats} aria-hidden="true">
        {Array.from({ length: BEAT_COUNT }, (_, i) => (
          <i key={i} className={i === beat ? s.beatOn : undefined} />
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const [card, setCard] = useState<Card>(STILL);
  const [beat, setBeat] = useState(2);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cycle = useRef(0);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const run = useCallback((i: number) => {
    clear();
    setBeat(i);
    const b = beatAt(i, cycle.current);
    for (const [at, patch] of b.steps) {
      timers.current.push(setTimeout(() => setCard((c) => ({ ...c, ...(typeof patch === 'function' ? patch(c) : patch) })), at));
    }
    timers.current.push(
      setTimeout(() => {
        const n = (i + 1) % BEAT_COUNT;
        if (n === 0) cycle.current += 1;
        run(n);
      }, b.total),
    );
  }, []);

  useEffect(() => {
    if (reduce === null) return;
    if (reduce) {
      clear();
      setCard(STILL);
      setBeat(2);
      return;
    }
    run(0);
    return clear;
  }, [reduce, run]);

  const instant = reduce !== false;
  return (
    <section className={s.hero}>
      <div>
        <Headline tail={card.headline} instant={instant} />
        <p className={cx(s.sub, s.reveal, s.d2)}>
          Log a bill in plain words and Quits proposes who owes what, with its reason. Correct it once and it remembers, in every group you share. Settle in USDC on Sui in one tap, or let your agent.
        </p>
        <div className={cx(s.ctas, s.reveal, s.d3)}>
          <Link href="/demo" className="btn btn-mem btn-lg">
            Open the demo group
          </Link>
          <a href="#memories" className="btn btn-ghost btn-lg">
            How it remembers
          </a>
        </div>
        <p className={cx(s.proof, s.reveal, s.d4)}>Live on Sui mainnet · memories on Walrus · reads and writes through Tatum</p>
      </div>
      <BillCard c={card} beat={beat} instant={instant} onNext={() => !reduce && run((beat + 1) % BEAT_COUNT)} />
    </section>
  );
}
