import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const slackCookie = cookieStore.get('wonderly_slack');

  if (!slackCookie) {
    return NextResponse.json({ connected: false });
  }

  try {
    const slack = JSON.parse(slackCookie.value);
    return NextResponse.json({
      connected: true,
      info: {
        team_name: slack.team_name,
        channel_name: slack.channel_name,
      },
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
