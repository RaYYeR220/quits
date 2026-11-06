import { Hero } from '@/components/landing/hero.tsx';
import s from '@/components/landing/landing.module.css';
import { CheckEverything, HowItWorks, LandingFooter, LandingNav, Memories, Settling } from '@/components/landing/sections.tsx';

export default function Home() {
  return (
    <>
      <div className="grain" aria-hidden="true" />
      <div className="pool pool-a" aria-hidden="true" />
      <div className="pool pool-b" aria-hidden="true" />
      <div className={s.page}>
        <div className={s.container}>
          <LandingNav />
          <main>
            <Hero />
            <HowItWorks />
            <Memories />
            <Settling />
            <CheckEverything />
          </main>
          <LandingFooter />
        </div>
      </div>
    </>
  );
}
