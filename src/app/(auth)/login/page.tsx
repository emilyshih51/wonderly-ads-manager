'use client';

import { BarChart2, Bot, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  {
    icon: BarChart2,
    title: 'Real-time Analytics',
    desc: 'Track spend, results, CTR, and CPA across all your campaigns in one view.',
  },
  {
    icon: Zap,
    title: 'Smart Automation',
    desc: 'Set rules that automatically pause, adjust, or scale your ads based on performance.',
  },
  {
    icon: Bot,
    title: 'AI Chat Assistant',
    desc: 'Ask questions about your campaigns and get instant, data-driven insights.',
  },
];

export default function LoginPage() {
  const handleLogin = () => {
    window.location.href = '/api/auth/facebook';
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel — dark branding */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 to-blue-950 p-12 lg:flex lg:w-[60%]">
        {/* Background grid pattern */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500 shadow-lg shadow-blue-500/30">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-white">Wonderly Ads Manager</span>
        </div>

        {/* Headline */}
        <div className="relative space-y-8">
          <div>
            <h1 className="text-4xl leading-tight font-bold text-white xl:text-5xl">
              Your Meta ads,
              <br />
              <span className="text-blue-400">on autopilot.</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-slate-400">
              Manage, automate, and optimize your Facebook and Instagram ad campaigns — all in one
              place.
            </p>
          </div>

          {/* Feature bullets */}
          <ul className="space-y-5">
            {features.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/15 ring-1 ring-blue-500/25">
                  <Icon className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom attribution */}
        <p className="relative text-xs text-slate-600">
          © {new Date().getFullYear()} Wonderly. Powered by Meta Marketing API.
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[var(--color-background)] px-8 py-12">
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-[var(--color-foreground)]">Wonderly Ads Manager</span>
        </div>

        <div className="w-full max-w-sm space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-[var(--color-foreground)]">Welcome back</h2>
            <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
              Sign in with your Meta account to continue.
            </p>
          </div>

          <Button onClick={handleLogin} className="h-12 w-full gap-3 text-sm font-medium" size="lg">
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Continue with Facebook
          </Button>

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            Access is restricted to authorized accounts only.
            <br />
            Contact your administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  );
}
