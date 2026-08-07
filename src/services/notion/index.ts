/**
 * Minimal Notion client — just enough to publish the daily acquisition readout as a dated
 * page inside a "Growth report" container under the *Cost per Succeeding Contractor* spec.
 *
 * Deliberately not the official SDK: this needs two endpoints (create a page, list a page's
 * children) and a handful of block types, and pulling in the SDK for that would add a
 * dependency and a versioning surface for no benefit. If Notion usage grows past publishing
 * readouts, replace this with `@notionhq/client`.
 *
 * @example
 * const notion = createNotionService();
 * const container = await notion?.ensureChildPage(specId, 'Growth report');
 * await notion?.createPage(container.id, 'Growth — acquisition update 2026-08-07', blocks);
 */

import { createLogger } from '@/services/logger';

const logger = createLogger('NotionService');

const NOTION_API = 'https://api.notion.com/v1';

/** Pinned per Notion's API versioning — bumping this can change response shapes. */
const NOTION_VERSION = '2022-06-28';

/** A table to render: a header row followed by body rows. All cells are plain text. */
export interface NotionTable {
  headers: string[];
  rows: string[][];
}

/** One Notion block. Untyped by design — this file builds them, nothing else inspects them. */
type NotionBlock = Record<string, unknown>;

/** Wrap plain text as Notion's rich-text array. */
function richText(text: string): NotionBlock[] {
  return [{ type: 'text', text: { content: text } }];
}

/** A paragraph block. */
export function paragraph(text: string): NotionBlock {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

/** A heading-2 block. */
export function heading(text: string): NotionBlock {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: richText(text) } };
}

/** A callout block, used for the goal banner. */
export function callout(text: string, emoji = '🎯'): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: { rich_text: richText(text), icon: { type: 'emoji', emoji } },
  };
}

/** A bulleted list item. */
export function bullet(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText(text) },
  };
}

/**
 * A Notion `table` block with a header row.
 *
 * Notion requires every row to have exactly `table_width` cells, so short rows are padded
 * and long rows truncated — a ragged table is rejected by the API with an unhelpful error.
 *
 * @param table - Header and body rows
 */
export function tableBlock(table: NotionTable): NotionBlock {
  const width = table.headers.length;

  const toRow = (cells: string[]): NotionBlock => ({
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: Array.from({ length: width }, (_, i) => richText(cells[i] ?? '')),
    },
  });

  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: [toRow(table.headers), ...table.rows.map(toRow)],
    },
  };
}

/** A created or located Notion page. */
export interface NotionPage {
  id: string;
  /** Public url. Empty when Notion omitted it (only on pages we located, not created). */
  url: string;
}

export class NotionService {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /** Standard auth + version headers for every call. */
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a child page under a parent page.
   *
   * @param parentPageId - Parent page id (dashed or bare uuid)
   * @param title - Page title
   * @param blocks - Page content blocks (max 100 — Notion's per-request child limit)
   * @returns The new page, or `null` when the call failed
   */
  async createPage(
    parentPageId: string,
    title: string,
    blocks: NotionBlock[] = []
  ): Promise<NotionPage | null> {
    try {
      const response = await this.fetchFn(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          parent: { type: 'page_id', page_id: parentPageId },
          properties: { title: { title: richText(title) } },
          children: blocks.slice(0, 100),
        }),
      });

      const data = (await response.json()) as { id?: string; url?: string; message?: string };

      if (!response.ok || !data.id) {
        logger.error('Notion page create failed', { status: response.status, error: data.message });

        return null;
      }

      return { id: data.id, url: data.url ?? '' };
    } catch (error) {
      logger.error('Notion page create threw', { error });

      return null;
    }
  }

  /**
   * Find a direct child page of `parentPageId` by exact title.
   *
   * Only the first 100 children are scanned — the container this looks for is created early
   * and therefore sits near the top, and paginating the whole spec page every morning to
   * re-find a page we already expect would be wasted calls.
   *
   * @param parentPageId - Page whose children to scan
   * @param title - Exact title to match
   * @returns The matching page, or `null` when absent or the call failed
   */
  async findChildPage(parentPageId: string, title: string): Promise<NotionPage | null> {
    try {
      const response = await this.fetchFn(
        `${NOTION_API}/blocks/${parentPageId}/children?page_size=100`,
        { headers: this.headers() }
      );

      const data = (await response.json()) as {
        results?: { id: string; type: string; child_page?: { title: string } }[];
        message?: string;
      };

      if (!response.ok) {
        logger.error('Notion children list failed', {
          status: response.status,
          error: data.message,
        });

        return null;
      }

      const match = (data.results ?? []).find(
        (b) => b.type === 'child_page' && b.child_page?.title === title
      );

      return match ? { id: match.id, url: '' } : null;
    } catch (error) {
      logger.error('Notion children list threw', { error });

      return null;
    }
  }

  /**
   * Get the child page with this title, creating it if it does not exist yet.
   *
   * Used for the "Growth report" container that the dated readouts are filed under, so the
   * spec page keeps one child instead of accumulating one per day. Idempotent: the container
   * is created on the first run and reused forever after.
   *
   * @param parentPageId - Page to look under and create in
   * @param title - Container page title
   * @param blocks - Blocks used only when creating it for the first time
   */
  async ensureChildPage(
    parentPageId: string,
    title: string,
    blocks: NotionBlock[] = []
  ): Promise<NotionPage | null> {
    return (
      (await this.findChildPage(parentPageId, title)) ??
      this.createPage(parentPageId, title, blocks)
    );
  }
}

/**
 * Build a Notion service from `NOTION_TOKEN`.
 *
 * @returns The service, or `null` when the token is unset — publishing is optional, and a
 *   missing token should degrade the cron to "computed but not published", not fail it.
 */
export function createNotionService(): NotionService | null {
  const token = process.env.NOTION_TOKEN;

  if (!token) {
    logger.warn('NOTION_TOKEN not set — skipping Notion publish');

    return null;
  }

  return new NotionService(token);
}
