'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, ExternalLink, CheckCircle2, Settings2 } from 'lucide-react';

export default function SettingsPage() {
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackInfo, setSlackInfo] = useState<{ team_name?: string; channel_name?: string } | null>(null);

  useEffect(() => {
    // Check URL params for slack connection status
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack') === 'connected') {
      setSlackConnected(true);
    }

    // Check cookie for slack connection
    fetch('/api/auth/slack/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.connected) {
          setSlackConnected(true);
          setSlackInfo(data.info);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your integrations and account settings.</p>
      </div>

      <div className="space-y-6">
        {/* Slack Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                  <MessageSquare className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Slack Integration</CardTitle>
                  <CardDescription>Receive automation notifications in Slack.</CardDescription>
                </div>
              </div>
              {slackConnected ? (
                <Badge variant="active">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                </Badge>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {slackConnected ? (
              <div className="space-y-3">
                {slackInfo && (
                  <div className="text-sm text-gray-600">
                    <p>Workspace: <span className="font-medium text-gray-900">{slackInfo.team_name}</span></p>
                    <p>Channel: <span className="font-medium text-gray-900">#{slackInfo.channel_name}</span></p>
                  </div>
                )}
                <div className="flex gap-3">
                  <Button variant="outline" size="sm" asChild>
                    <a href="/api/auth/slack/redirect">
                      <ExternalLink className="h-4 w-4 mr-2" /> Reconnect
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <Button asChild>
                <a href="/api/auth/slack/redirect">
                  <MessageSquare className="h-4 w-4 mr-2" /> Connect Slack
                </a>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Meta Account Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <Settings2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">Meta Account</CardTitle>
                <CardDescription>Your connected Meta ad account.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              Signed in via Facebook. Your Meta access token refreshes automatically.
            </p>
            <div className="mt-4">
              <Button variant="destructive" size="sm" asChild>
                <a href="/api/auth/logout">Sign Out</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
