import type { CardSummary, PersonDisplay } from '@flowboard/contracts';

/** Marketing sample content for the /signin board preview. Invented people and cards; nothing here is user data. */
export interface PreviewColumn { id: string; name: string; tone: 'backlog' | 'progress' | 'testing' | 'blocked' | 'completed'; done: boolean }

export const PREVIEW_COLUMNS: PreviewColumn[] = [
  { id: 'backlog', name: 'Not started', tone: 'backlog', done: false },
  { id: 'progress', name: 'In progress', tone: 'progress', done: false },
  { id: 'testing', name: 'Testing', tone: 'testing', done: false },
  { id: 'blocked', name: 'Blocked', tone: 'blocked', done: false },
  { id: 'completed', name: 'Completed', tone: 'completed', done: true },
];

// Two invented people. Same initials, so the avatar colour (from the id) and the visible first name tell them apart.
const PEOPLE: PersonDisplay[] = [
  { id: 'sample-john', displayName: 'John Doe', avatarUrl: null, activeInProject: true },
  { id: 'sample-jane', displayName: 'Jane Doe', avatarUrl: null, activeInProject: true },
];
export const PREVIEW_PEOPLE = new Map(PEOPLE.map((person) => [person.id, person]));

interface Seed {
  key: string; title: string; excerpt: string; priority: CardSummary['priority'];
  /** Days from today (0 = no due date). Negative only for cards that start in Completed, so nothing ever reads as overdue. */
  due: number; who: string; comments: number; images: number; column: string;
}

const SEEDS: Seed[] = [
  { key: 'WEB-106', title: 'Run many projects', excerpt: 'Switch between projects in one place.', priority: 'low', due: 16, who: 'sample-jane', comments: 0, images: 0, column: 'backlog' },
  { key: 'WEB-107', title: 'Import from a spreadsheet', excerpt: 'Bring your plan in from an XLSX file.', priority: 'medium', due: 21, who: 'sample-john', comments: 2, images: 0, column: 'backlog' },
  { key: 'WEB-104', title: 'Private by invitation', excerpt: 'Only invited people can open a project.', priority: 'high', due: 9, who: 'sample-john', comments: 3, images: 1, column: 'progress' },
  { key: 'WEB-105', title: 'Discuss on the card', excerpt: 'Comments and mentions stay with the work.', priority: 'medium', due: 0, who: 'sample-jane', comments: 8, images: 0, column: 'progress' },
  { key: 'WEB-103', title: 'Clear owners and dates', excerpt: 'Every card shows who owns it.', priority: 'high', due: 3, who: 'sample-john', comments: 1, images: 0, column: 'testing' },
  { key: 'WEB-108', title: 'Keyboard friendly', excerpt: 'Move cards without a mouse.', priority: 'low', due: 5, who: 'sample-jane', comments: 0, images: 0, column: 'testing' },
  { key: 'WEB-109', title: 'Flag what is stuck', excerpt: 'Blocked work stays visible.', priority: 'high', due: 6, who: 'sample-john', comments: 2, images: 0, column: 'blocked' },
  { key: 'WEB-101', title: 'See every project', excerpt: 'One view of all your boards.', priority: 'medium', due: -2, who: 'sample-jane', comments: 0, images: 0, column: 'completed' },
  { key: 'WEB-102', title: 'Idea to done', excerpt: 'Drag cards as the work moves forward.', priority: 'low', due: -1, who: 'sample-john', comments: 0, images: 0, column: 'completed' },
];

const dateOnly = (offsetDays: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Built on the client after mount because due dates are relative to today. */
export function buildPreviewCards(): { cards: Map<string, CardSummary>; order: Record<string, string[]> } {
  const now = new Date().toISOString();
  const cards = new Map<string, CardSummary>();
  const order: Record<string, string[]> = Object.fromEntries(PREVIEW_COLUMNS.map((column) => [column.id, []]));
  SEEDS.forEach((seed, index) => {
    const id = `sample-${seed.key.toLowerCase()}`;
    cards.set(id, {
      id, boardId: 'sample-board', columnId: seed.column, title: seed.title, key: seed.key, descriptionExcerpt: seed.excerpt,
      priority: seed.priority, dueDate: seed.due === 0 ? null : dateOnly(seed.due), assigneeIds: [seed.who], position: index, version: 0,
      commentCount: seed.comments, imageCount: seed.images, createdAt: now, updatedAt: now,
    });
    order[seed.column]!.push(id);
  });
  return { cards, order };
}

export const PREVIEW_COUNTS: Record<string, number> = SEEDS.reduce<Record<string, number>>((acc, seed) => {
  acc[seed.column] = (acc[seed.column] ?? 0) + 1;
  return acc;
}, {});
