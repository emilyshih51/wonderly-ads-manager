'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, ExternalLink, CheckCircle2, Settings2, Copy, Check } from 'lucide-react';

export default function SettingsPage() {
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackBotConfigured, setSlackBotConfigured] = useState(false);
  const [slackInfo, setSlackInfo] = useState<{ team_name?: string; channel_name?: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const eventUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/slack/events`;
  const interactionUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/slack/interactions`;

  useEffect(() => {
    // Check if Slack bot is configured
    fetch('/api/slack/status')
      .then((res) => res.json())
      .then((data) => {
        setSlackBotConfigured(data.configured || false);
      })
      .catch(() => {});

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

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(id);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your integrations and account settings.</p>
      </div>

      <div className="space-y-6">
        {/* Slack Bot Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                  <MessageSquare className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Slack Bot Integration</CardTitle>
                  <CardDescription>Ask the bot about ad performance in Slack channels.</CardDescription>
                </div>
              </div>
              {slackBotConfigured ? (
                <Badge variant="active">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
                </Badge>
              ) : (
                <Badge variant="secondary">Not configured</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {slackBotConfigured ? (
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  Your Slack bot is configured! @mention it in any Slack channel to ask about ad performance.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 text-sm mb-3">Setup Instructions:</h4>
                  <ol className="text-sm text-blue-800 space-y-2">
                    <li>1. Create a Slack app at <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">api.slack.com/apps</a></li>
                    <li>2. Go to "Socket Mode" and enable it, save the app-level token as <code className="bg-white px-2 py-1 rounded text-xs">xapp_*....</code></li>
                    <li>3. Go to "Event Subscriptions" and enable events</li>
                    <li>4. Set the Request URL (see below) and subscribe to <code className="bg-white px-2 py-1 rounded text-xs">app_mention</code> events</li>
                    <li>5. Go to "Interactivity" and enable it with the Interactions URL (see below)</li>
                    <li>6. Go to "OAuth & Permissions" and add scopes: <code className="bg-white px-2 py-1 rounded text-xs">chat:write</code>, <code className="bg-white px-2 py-1 rounded text-xs">app_mentions:read</code></li>
                    <li>7. Install the app to your workspace and copy the Bot Token</li>
                    <li>8. Set environment variables: <code className="bg-white px-2 py-1 rounded text-xs">SLACK_BOT_TOKEN</code>, <code className="bg-white px-2 py-1 rounded text-xs">SLACK_SIGNING_SECRET</code></li>
                  </ol>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Event Request URL:</label>
                    <div className="flex gap-2 mt-1">
                      <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm text-gray-700 break-all">
                        {eventUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(eventUrl, 'event-url')}
                      >
                        {copiedUrl === 'event-url' ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700">Interactivity Request URL:</label>
                    <div className="flex gap-2 mt-1">
                      <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm text-gray-700 break-all">
                        {interactionUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(interactionUrl, 'interaction-url')}
                      >
                        {copiedUrl === 'interaction-url' ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
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
