import type { CardSummary, PersonDisplay } from '@flowboard/contracts';

/** Marketing sample content for the /signin board preview. Invented people and cards; nothing here is user data. */
export interface PreviewColumn { id: string; name: string; tone: 'backlog' | 'progress' | 'testing' | 'completed'; done: boolean }

export const PREVIEW_COLUMNS: PreviewColumn[] = [
  { id: 'backlog', name: 'Not started', tone: 'backlog', done: false },
  { id: 'progress', name: 'In progress', tone: 'progress', done: false },
  { id: 'testing', name: 'Testing', tone: 'testing', done: false },
  { id: 'completed', name: 'Completed', tone: 'completed', done: true },
];

const PEOPLE: PersonDisplay[] = [
  { id: 'sample-alex', displayName: 'Alex Rivera', avatarUrl: null, activeInProject: true },
  { id: 'sample-morgan', displayName: 'Morgan Lee', avatarUrl: null, activeInProject: true },
  { id: 'sample-jamie', displayName: 'Jamie Chen', avatarUrl: null, activeInProject: true },
  { id: 'sample-priya', displayName: 'Priya Nair', avatarUrl: null, activeInProject: true },
  { id: 'sample-sam', displayName: 'Sam Okafor', avatarUrl: null, activeInProject: true },
];
export const PREVIEW_PEOPLE = new Map(PEOPLE.map((person) => [person.id, person]));

interface Seed {
  key: string; title: string; excerpt: string; priority: CardSummary['priority'];
  /** Days from today. Negative only for cards that start in Completed, so nothing ever reads as overdue. */
  due: number; who: string; comments: number; images: number; column: string;
}

const SEEDS: Seed[] = [
  { key: 'WEB-106', title: 'Run many projects side by side', excerpt: 'Switch between projects and see only the work you are allowed to open.', priority: 'low', due: 16, who: 'sample-alex', comments: 1, images: 0, column: 'backlog' },
  { key: 'WEB-107', title: 'Bring your plan in from a spreadsheet', excerpt: 'Upload an XLSX, check the preview, then import every card in one step.', priority: 'medium', due: 21, who: 'sample-morgan', comments: 2, images: 1, column: 'backlog' },
  { key: 'WEB-104', title: 'Private by default, shared by invitation', excerpt: 'Only invited people see a project. Each board and image needs its own access.', priority: 'high', due: 9, who: 'sample-priya', comments: 3, images: 1, column: 'progress' },
  { key: 'WEB-105', title: 'Discuss work on the card itself', excerpt: 'Comments and mentions keep every decision next to the work it belongs to.', priority: 'medium', due: 12, who: 'sample-sam', comments: 8, images: 1, column: 'progress' },
  { key: 'WEB-103', title: 'Know who owns what and when it is due', excerpt: 'Every card shows its owner, priority and due date, so nothing slips.', priority: 'high', due: 3, who: 'sample-jamie', comments: 6, images: 2, column: 'testing' },
  { key: 'WEB-101', title: 'See every project in one place', excerpt: 'One view of every project and board you can open, with progress at a glance.', priority: 'medium', due: -2, who: 'sample-alex', comments: 4, images: 0, column: 'completed' },
  { key: 'WEB-102', title: 'Move work from idea to done', excerpt: 'Drag a card across the columns as the work moves from planned to finished.', priority: 'low', due: -1, who: 'sample-morgan', comments: 2, images: 1, column: 'completed' },
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
      priority: seed.priority, dueDate: dateOnly(seed.due), assigneeIds: [seed.who], position: index, version: 0,
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
