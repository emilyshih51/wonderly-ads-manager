import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getRedisClient } from '@/lib/redis';
import { ChatMemoryService } from '@/services/chat-memory';
import { createLogger } from '@/services/logger';

const logger = createLogger('Chat:History');

/**
 * GET /api/chat/history
 *
 * Returns the user's stored chat message history from Redis.
 */
export async function GET() {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  logger.info('GET /api/chat/history');

  const redis = await getRedisClient();
  const memory = new ChatMemoryService(redis);
  const messages = await memory.getHistory(session.id);

  return NextResponse.json({ messages });
}

/**
 * DELETE /api/chat/history
 *
 * Clears all chat history for the current user.
 */
export async function DELETE() {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  logger.info('DELETE /api/chat/history');

  const redis = await getRedisClient();
  const memory = new ChatMemoryService(redis);

  await memory.clearHistory(session.id);

  return NextResponse.json({ success: true });
}
