import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { cookies } from 'next/headers';
import { metaApi, updateStatus } from '@/lib/meta-api';

// This endpoint can be called by a Vercel cron job
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = await cookies();
  const rulesCookie = cookieStore.get('wonderly_automation_rules');
  const slackCookie = cookieStore.get('wonderly_slack');

  const rules = rulesCookie ? JSON.parse(rulesCookie.value) : [];
  const slackConnection = slackCookie ? JSON.parse(slackCookie.value) : null;
  const activeRules = rules.filter((r: { is_active: boolean }) => r.is_active);

  const results = [];

  for (const rule of activeRules) {
    try {
      // Extract trigger and action nodes
      const triggerNode = rule.nodes.find((n: { type: string }) => n.type === 'trigger');
      const conditionNode = rule.nodes.find((n: { type: string }) => n.type === 'condition');
      const actionNode = rule.nodes.find((n: { type: string }) => n.type === 'action');

      if (!triggerNode || !actionNode) continue;

      const config = conditionNode?.data?.config || {};
      const triggerConfig = triggerNode.data?.config || {};
      const actionConfig = actionNode.data?.config || {};

      // Get the entity's insights
      const entityType = triggerConfig.entity_type || 'adset'; // 'campaign', 'adset', 'ad'
      const entityId = triggerConfig.entity_id;

      if (!entityId) continue;

      const insights = await metaApi(`/${entityId}/insights`, session.meta_access_token, {
        params: {
          fields: 'spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type',
          date_preset: 'today',
        },
      });

      const insightData = insights.data?.[0];
      if (!insightData) continue;

      // Evaluate condition
      const metric = config.metric || 'spend';
      const operator = config.operator || '>';
      const threshold = parseFloat(config.threshold || '0');
      const actualValue = parseFloat(insightData[metric] || '0');

      let conditionMet = false;
      switch (operator) {
        case '>': conditionMet = actualValue > threshold; break;
        case '<': conditionMet = actualValue < threshold; break;
        case '>=': conditionMet = actualValue >= threshold; break;
        case '<=': conditionMet = actualValue <= threshold; break;
        case '==': conditionMet = actualValue === threshold; break;
      }

      if (!conditionMet) continue;

      // Execute action
      const actionType = actionConfig.action_type;

      if (actionType === 'pause') {
        await updateStatus(entityId, session.meta_access_token, 'PAUSED');
        results.push({ rule: rule.name, action: 'paused', entity: entityId });
      } else if (actionType === 'activate') {
        await updateStatus(entityId, session.meta_access_token, 'ACTIVE');
        results.push({ rule: rule.name, action: 'activated', entity: entityId });
      }

      if (actionType === 'slack_notify' || actionConfig.also_notify_slack) {
        if (slackConnection) {
          const message = `*Automation "${rule.name}" triggered*\n${entityType} ${entityId}: ${metric} = $${actualValue.toFixed(2)} (threshold: ${operator} $${threshold})${actionType !== 'slack_notify' ? `\nAction taken: ${actionType}` : ''}`;

          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/slack/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          });
        }
      }

      results.push({ rule: rule.name, triggered: true, metric, value: actualValue, threshold });
    } catch (error) {
      console.error(`Rule evaluation error for ${rule.name}:`, error);
      results.push({ rule: rule.name, error: String(error) });
    }
  }

  return NextResponse.json({ evaluated: activeRules.length, results });
}
