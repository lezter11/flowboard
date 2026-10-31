import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatPersonName, personAria } from '../src/lib/person-name.ts';

test('a suffix of 2 or more is shown; absent, null and bad values show the plain name', () => {
  assert.equal(formatPersonName({ displayName: 'Shubham Singh', nameSuffix: 2 }), 'Shubham Singh (2)');
  assert.equal(formatPersonName({ displayName: 'Shubham Singh', nameSuffix: null }), 'Shubham Singh');
  assert.equal(formatPersonName({ displayName: 'Shubham Singh' }), 'Shubham Singh');
  assert.equal(formatPersonName({ displayName: 'Shubham Singh', nameSuffix: 1 }), 'Shubham Singh');
  assert.equal(formatPersonName(undefined, 'Former member'), 'Former member');
});

test('screen readers hear "Shubham Singh, number 2, Member"', () => {
  assert.equal(personAria({ displayName: 'Shubham Singh', nameSuffix: 2 }, 'Member'), 'Shubham Singh, number 2, Member');
  assert.equal(personAria({ displayName: 'Priya Rao' }, 'Owner'), 'Priya Rao, Owner');
});

test('every screen that names a person goes through the one helper', () => {
  for (const f of ['../src/app/add-card/page.tsx', '../src/app/activity/page.tsx', '../src/components/board/board-view.tsx', '../src/components/board/board-card.tsx', '../src/components/board/card-detail-drawer.tsx', '../src/components/shell/topbar.tsx', '../src/lib/people.ts']) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /formatPersonName/, f);
  }
});
