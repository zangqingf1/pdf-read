import LandingNav from '../components/landing/LandingNav';
import Hero from '../components/landing/Hero';
import AuthenticitySection from '../components/landing/AuthenticitySection';
import FeaturesShowcase from '../components/landing/FeaturesShowcase';
import WorkflowSection from '../components/landing/WorkflowSection';
import AudienceSection from '../components/landing/AudienceSection';
import ClosingSection from '../components/landing/ClosingSection';

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-canvas text-body antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-on-primary"
      >
        跳到主要内容
      </a>
      <LandingNav />
      <main id="main">
        <Hero />
        <AuthenticitySection />
        <FeaturesShowcase />
        <WorkflowSection />
        <AudienceSection />
        <ClosingSection />
      </main>
    </div>
  );
}
