// Meta API Types
export interface MetaCampaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time: string;
  updated_time: string;
  insights?: MetaInsights;
}

export interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  campaign?: { name: string };
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  daily_budget?: string;
  lifetime_budget?: string;
  targeting?: Record<string, unknown>;
  optimization_goal?: string;
  billing_event?: string;
  bid_amount?: string;
  start_time?: string;
  end_time?: string;
  created_time: string;
  updated_time: string;
  insights?: MetaInsights;
}

export interface MetaAd {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  creative?: MetaAdCreative;
  created_time: string;
  updated_time: string;
  insights?: MetaInsights;
}

export interface MetaAdCreative {
  id: string;
  name: string;
  title?: string;
  body?: string;
  image_url?: string;
  image_hash?: string;
  video_id?: string;
  link_url?: string;
  call_to_action_type?: string;
  object_story_spec?: Record<string, unknown>;
  thumbnail_url?: string;
}

export interface MetaInsights {
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  reach: string;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  date_start: string;
  date_stop: string;
}

export interface MetaAction {
  action_type: string;
  value: string;
}

export interface MetaInsightsTimeSeries {
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  actions?: MetaAction[];
}

// Automation Types
export interface AutomationRule {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  created_at: string;
  updated_at: string;
}

export interface AutomationNode {
  id: string;
  type: 'trigger' | 'condition' | 'action';
  position: { x: number; y: number };
  data: {
    label: string;
    config: Record<string, unknown>;
  };
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// Slack Types
export interface SlackConnection {
  id: string;
  user_id: string;
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
  access_token: string;
  webhook_url?: string;
  created_at: string;
}

// User / Session
export interface UserSession {
  id: string;
  email: string;
  name: string;
  meta_access_token: string;
  meta_user_id: string;
  ad_account_id: string;
}

// Dashboard
export interface DashboardMetrics {
  amount_spent: number;
  cpm: number;
  ctr: number;
  cpc: number;
  results: number;
  cost_per_result: number | null;
}
