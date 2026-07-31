/**
 * Read-only Growth MCP server (hosted, streamable HTTP).
 *
 * Exposes the Growth Sheet intelligence as MCP tools so any MCP client (Claude Desktop,
 * Cowork, Claude Code) can query the funnel, CAC, cohorts, deals, and ad performance
 * directly — reusing the same Meta + Snowflake reads and lib functions as the cron.
 *
 * Read-only: no writes, no ad changes, no sheet mutation. Auth: OAuth 2.1 (the client runs
 * the flow against `/api/oauth/*`; the user is gated by the app login) — an unauthenticated
 * request gets a 401 pointing at the resource metadata, which kicks off the flow. A static
 * `MCP_TOKEN` bearer is also accepted, for header-capable clients (e.g. Claude Code).
 * Endpoint: POST `/api/mcp/mcp` (streamable HTTP). Node runtime, longer timeout for Snowflake.
 */

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

import { DAILY_FUNNEL_HEADERS, toDailyFunnelValues } from '@/lib/daily-funnel';
import { adPerformance, fetchGrowthData } from '@/lib/growth-data';
import { HISTORICAL_CAC_HEADERS, toHistoricalCacValues } from '@/lib/historical-cac';
import { baseUrl, isValidToken } from '@/lib/mcp-oauth';
import { computeOverview } from '@/lib/overview';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Wrap a value as an MCP text-content result (pretty JSON). */
function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'growth_overview',
      'Headline KPIs and warnings: cost per Call 1 booked, cost per accepted contractor (7d & 30d, booking-day cohort), succeeding-contractor status, data freshness, and the 7-day vs previous-7-day funnel. Returns the Overview matrix (rows of [label, value...]).',
      {},
      async () => {
        const { rows, call1Deals, succeeding, today } = await fetchGrowthData({
          rows: true,
          deals: true,
          succeeding: true,
        });

        return json(
          computeOverview({
            rows,
            call1Deals: call1Deals ?? [],
            succeeding: succeeding ?? {
              matured60: 0,
              succeeding60: 0,
              matured90: 0,
              succeeding90: 0,
              cohort60Start: '',
              cohort60End: '',
              cohort90Start: '',
              cohort90End: '',
            },
            lastRefreshedPt: 'live (MCP)',
            today,
          })
        );
      }
    );

    server.tool(
      'daily_funnel',
      'Per-day funnel since May 1 (newest first): FB spend → visits → CTA → partial → qualified → Call 1 booked → held → accepted, with step conversion rates and cost per step. Held/accepted are the booking-day cohort.',
      {
        days: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Only the most recent N days'),
      },
      async ({ days }) => {
        const { rows } = await fetchGrowthData({ rows: true });
        const slice = days ? rows.slice(0, days) : rows;

        return json({ headers: DAILY_FUNNEL_HEADERS, rows: toDailyFunnelValues(slice) });
      }
    );

    server.tool(
      'historical_cac',
      'Monthly + all-time cost to acquire an accepted contractor (CAC = FB spend ÷ accepted, booking-day cohort). Recent months are flagged "maturing"; the all-time row is the stable figure.',
      {},
      async () => {
        const { rows, today } = await fetchGrowthData({ rows: true });

        return json({ headers: HISTORICAL_CAC_HEADERS, rows: toHistoricalCacValues(rows, today) });
      }
    );

    server.tool(
      'call1_deals',
      'Deal-level Call 1 audit since May 1: one row per deal (booked, held, or accepted), with current stage, source, and the Meta CAMPAIGN_ID / AD_ID that drove it. Filterable.',
      {
        status: z
          .enum(['all', 'booked', 'held', 'accepted'])
          .optional()
          .describe('Filter to a stage (default all)'),
        campaignId: z.string().optional().describe('Exact Meta campaign id'),
        adId: z.string().optional().describe('Exact Meta ad id'),
        bookedAfter: z
          .string()
          .optional()
          .describe('Only deals with booked_day >= this YYYY-MM-DD'),
        limit: z.number().int().positive().max(2000).optional().describe('Max rows (default 200)'),
      },
      async ({ status, campaignId, adId, bookedAfter, limit }) => {
        const { call1Deals = [] } = await fetchGrowthData({ rows: false, deals: true });

        const filtered = call1Deals.filter((d) => {
          if (status === 'accepted' && d.accepted !== 1) return false;
          if (status === 'held' && d.held !== 1) return false;
          if (status === 'booked' && !d.bookedDay) return false;
          if (campaignId && d.campaignId !== campaignId) return false;
          if (adId && d.adId !== adId) return false;
          if (bookedAfter && d.bookedDay < bookedAfter) return false;

          return true;
        });

        return json({ total: filtered.length, deals: filtered.slice(0, limit ?? 200) });
      }
    );

    server.tool(
      'ad_performance',
      'Rank Meta ads by yield — booked deals, held, accepted, and accept rate per ad (and its campaign) since May 1. The "which ad wins" view. Organic/unattributed deals are excluded.',
      {
        minBooked: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Only ads with at least N booked'),
      },
      async ({ minBooked }) => {
        const { call1Deals = [] } = await fetchGrowthData({ rows: false, deals: true });
        const ranked = adPerformance(call1Deals).filter((a) => a.booked >= (minBooked ?? 0));

        return json({ ads: ranked });
      }
    );

    server.tool(
      'customer_pnl',
      'Daily customer P&L (paying customers): modeled expected contribution (EV take), actual Meta spend run for customers, and EV − spend. EV is forward-looking, so daily PnL is lumpy.',
      {
        days: z
          .number()
          .int()
          .positive()
          .max(365)
          .optional()
          .describe('Trailing days (default 90)'),
      },
      async ({ days }) => {
        const { customerPnl = [] } = await fetchGrowthData({
          rows: false,
          pnl: true,
          pnlDays: days,
        });

        return json({ rows: customerPnl });
      }
    );
  },
  {},
  { basePath: '/api/mcp', maxDuration: 60 }
);

/** 401 that tells the client where to discover the OAuth flow (RFC 9728). */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${baseUrl()}/.well-known/oauth-protected-resource"`,
    },
  });
}

/**
 * Require either a valid OAuth access token (issued by `/api/oauth/*`) or the static
 * `MCP_TOKEN` bearer. Anything else → 401 with the metadata pointer that starts OAuth.
 */
function authed(fn: (req: Request) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!token) return unauthorized();
    if (process.env.MCP_TOKEN && token === process.env.MCP_TOKEN) return fn(req);
    if (await isValidToken(token)) return fn(req);

    return unauthorized();
  };
}

const guarded = authed(handler);

export { guarded as GET, guarded as POST, guarded as DELETE };
