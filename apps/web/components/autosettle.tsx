'use client';

import { useEffect, useState } from 'react';
import { api, errorText, store } from './api.ts';
import { short, toMicro } from './format.ts';
import { useExplorer, useSession } from './session.tsx';
import type { GroupData, Mandate, MandateTerms } from './types.ts';
import { ErrorBlock, ExtLink, Money } from './ui.tsx';
import { useWallet } from './wallet.tsx';

function Terms({ t }: { t: MandateTerms }) {
  const secs = Math.round(t.objectionWindowMs / 1000);
  const rows: [string, React.ReactNode][] = [
    ['Per debt', <><span className="mono text-ink-3">≤ </span><Money micro={t.maxPerDebt} unit /></>],
    ['Per week', <><span className="mono text-ink-3">≤ </span><Money micro={t.weeklyLimit} unit /></>],
    ['Before each payment', <span className="money">{secs >= 3600 ? `${Math.round(secs / 3600)} h` : `${secs} s`} to object</span>],
    ['In total', <><span className="mono text-ink-3">≤ </span><Money micro={t.lifetimeCap} unit /><span className="meta"> for {t.days} days</span></>],
  ];
  return (
    <dl className="mt-4 divide-y divide-line rounded-[14px] border border-line px-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]">
          <dt className="text-ink-2">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AutoSettle({ data, limit, onChanged }: { data: GroupData; limit: bigint; onChanged: () => void }) {
  const { me, demoTerms: DEMO_TERMS } = useSession();
  const ex = useExplorer();
  const demo = Boolean(me?.demo);
  const mine = data.members.find((m) => m.id === data.me);
  const key = `quits.mandate.${data.group.id}.${data.me}`;
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = useWallet();

  useEffect(() => {
    setMandate(store.get<Mandate>(key));
    setError(null);
  }, [key]);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      let r: Mandate;
      if (demo) r = await api<Mandate>(`/api/groups/${data.group.id}/autosettle`, { body: {} });
      else {
        // The server builds the allowance + mandate transaction, the wallet signs it, the server submits it through Tatum.
        const prep = await api<{ txBytes: string }>(`/api/groups/${data.group.id}/autosettle`, { body: { step: 'prepare' } });
        const signed = await wallet.signTxBytes(prep.txBytes);
        r = await api<Mandate>(`/api/groups/${data.group.id}/autosettle`, { body: { step: 'confirm', txBytes: signed.transaction, signature: signed.signature } });
      }
      setMandate(r);
      store.set(key, r);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const on = Boolean(mine?.autoSettle);
  const terms = mandate?.terms ?? DEMO_TERMS;
  // The agent never pays more per debt than the mandate allows, whatever it has learned.
  const cap = demo || mandate ? toMicro(terms.maxPerDebt) : null;
  const capped = cap !== null && cap < limit;
  const effective = capped ? cap : limit;

  return (
    <section aria-labelledby="auto-h" className="sheet p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="auto-h" className="h-sec">
          Auto-settle
        </h2>
        {on ? <span className="chip chip-solid">on for you</span> : <span className="meta">off for you</span>}
      </div>

      {!on ? (
        <>
          <p className="mt-2 text-[14px] leading-[1.55] text-ink-2">
            Sign one Sui allowance and your agent pays your debts in this group for you. It can only pay people in this group, only the exact debt, and never past these limits.
          </p>
          {demo ? <Terms t={DEMO_TERMS} /> : null}
          <div className="mt-4 flex flex-wrap items-center gap-3" aria-live="polite">
            <button type="button" className="btn btn-mem" onClick={() => void turnOn()} disabled={busy}>
              {busy ? (demo ? 'Signing the mandate on Sui…' : 'Check your wallet…') : 'Let my agent settle my debts here'}
            </button>
            {!demo ? <span className="meta">Your wallet signs one allowance: up to 20 USDC per debt and per week, 12 h to object.</span> : null}
          </div>
          {error ? (
            <div className="mt-3">
              <ErrorBlock message={error} />
            </div>
          ) : null}
        </>
      ) : (
        <div aria-live="polite">
          <p className="mt-2 text-[14px] leading-[1.55] text-ink-2">
            Debts within your limits are recorded on-chain, then paid through the same x402 endpoint once the objection window passes.
          </p>
          {mandate ? (
            <dl className="mt-4 flex flex-col gap-2 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <dt className="text-ink-2">Mandate</dt>
                <dd>
                  <ExtLink href={ex.object(mandate.mandateObjectId)} label={`Mandate object ${mandate.mandateObjectId}`}>
                    {short(mandate.mandateObjectId, 8, 6)}
                  </ExtLink>
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <dt className="text-ink-2">Allowance</dt>
                <dd>
                  <ExtLink href={ex.object(mandate.allowanceId)} label={`Allowance object ${mandate.allowanceId}`}>
                    {short(mandate.allowanceId, 8, 6)}
                  </ExtLink>
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <dt className="text-ink-2">Opened in</dt>
                <dd>
                  <ExtLink href={ex.tx(mandate.digest)} label={`Transaction ${mandate.digest}`}>
                    {short(mandate.digest, 8, 6)}
                  </ExtLink>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="meta mt-3">The mandate and allowance live on Sui under your address.</p>
          )}
          {demo || mandate ? <Terms t={terms} /> : null}
        </div>
      )}

      <div className="mt-5 rounded-[14px] bg-[rgba(242,236,228,.035)] px-4 py-3">
        <p className="text-[13.5px] text-ink">
          Pays without asking up to <Money micro={effective} unit />
        </p>
        <p className="meta mt-1">
          {capped ? <>Your learned limit is <Money micro={limit} />; this mandate caps each debt at <Money micro={cap} />. </> : null}
          Learned from your answers: approve a bigger payment and the limit rises to it; object to one and it drops to half.
        </p>
      </div>
    </section>
  );
}
