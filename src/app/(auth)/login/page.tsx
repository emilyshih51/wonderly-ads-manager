'use client';

import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const handleLogin = () => {
    window.location.href = '/api/auth/facebook';
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-10 shadow-xl border border-gray-100">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 shadow-lg">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">Wonderly Ads</h2>
          <p className="mt-2 text-sm text-gray-500">
            Manage your Meta ads, track performance, and automate your workflow.
          </p>
        </div>

        <Button onClick={handleLogin} className="w-full h-12 text-base" size="lg">
          <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
          Continue with Facebook
        </Button>

        <p className="text-center text-xs text-gray-400">
          Sign in with your Meta account to manage your ad campaigns.
        </p>
      </div>
    </div>
  );
}
