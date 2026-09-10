import { describe, it, expect } from 'vitest';

import { buildDriveCreativeIndex, matchDriveCreative } from '@/lib/drive-creative-match';

describe('drive-creative-match', () => {
  it('matches despite Meta sanitizing punctuation-to-underscore and zero-padding numbers', () => {
    const index = buildDriveCreativeIndex([
      { id: 'file-1', name: 'Brad - VID - 9.4 - Growth backing v1 - Home Addition - 3.2.mov' },
    ]);

    const match = matchDriveCreative(
      'Brad - VID - 09_04 _ Growth backing v1 _ Home Additions - 3.2 2026-09-04-17e6d43d9c71fa1136ea07a9687f5bb8',
      index
    );

    expect(match).toEqual({
      id: 'file-1',
      name: 'Brad - VID - 9.4 - Growth backing v1 - Home Addition - 3.2.mov',
    });
  });

  it('matches static-image creatives the same way as video creatives', () => {
    const index = buildDriveCreativeIndex([
      { id: 'file-2', name: 'Sara - STATIC - 9.4 - Growth backing v1 - ADU - 5.3.png' },
    ]);

    const match = matchDriveCreative(
      'Sara - STATIC - 09_04 _ Growth backing v1 _ ADU - 5.3 2026-09-04-abc123def456abc123def456abc123de',
      index
    );

    expect(match?.id).toBe('file-2');
  });

  it('returns undefined rather than a low-confidence guess when nothing matches', () => {
    const index = buildDriveCreativeIndex([{ id: 'file-1', name: 'Completely Different Ad.mov' }]);

    expect(
      matchDriveCreative('Some Other Ad 2026-09-04-17e6d43d9c71fa1136ea07a9687f5bb8', index)
    ).toBeUndefined();
  });

  it('is unaffected by a creative name with no upload-time suffix (e.g. authored directly in Ads Manager)', () => {
    const index = buildDriveCreativeIndex([{ id: 'file-1', name: 'Hand Authored Creative.png' }]);

    expect(matchDriveCreative('Hand Authored Creative', index)).toEqual({
      id: 'file-1',
      name: 'Hand Authored Creative.png',
    });
  });

  it('keeps the first file on a normalized-name collision rather than dropping the match', () => {
    const index = buildDriveCreativeIndex([
      { id: 'first', name: 'Duplicate Name.mov' },
      { id: 'second', name: 'Duplicate Name.png' },
    ]);

    expect(
      matchDriveCreative('Duplicate Name 2026-09-04-17e6d43d9c71fa1136ea07a9687f5bb8', index)?.id
    ).toBe('first');
  });
});
