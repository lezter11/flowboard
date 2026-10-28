export interface MockPerson {
  id: string;
  name: string;
  initials: string;
  role: 'Owner' | 'Manager' | 'Member' | 'Viewer';
  avatarTone: string;
  email: string;
}

export interface MockCard {
  id: string;
  key: string;
  title: string;
  description: string;
  boardId: string;
  boardName: string;
  columnId: 'col_todo' | 'col_progress' | 'col_done';
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  assigneeIds: string[];
  dueDate: string | null;
  commentCount: number;
  imageCount: number;
  taskCount?: { completed: number; total: number };
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MockBoard {
  id: string;
  projectId: string;
  previewAccessible: boolean;
  name: string;
  slug: string;
  description: string;
}

export const MOCK_PROJECT = {
  id: 'proj_fashion',
  name: 'Brand Fashion',
  slug: 'brand-fashion',
  description: 'Global brand identity, e-commerce storefront, and autumn campaign.',
};

export const MOCK_BOARDS: MockBoard[] = [
  {
    id: 'unified',
    projectId: MOCK_PROJECT.id,
    previewAccessible: true,
    name: 'Unified View (All Boards)',
    slug: 'unified',
    description: 'Consolidated view of cards across Developers, Ops, and Marketing boards.',
  },
  {
    id: 'board_dev',
    projectId: MOCK_PROJECT.id,
    previewAccessible: true,
    name: 'Developers Board',
    slug: 'dev',
    description: 'Frontend, API architecture, CI/CD pipelines, and performance.',
  },
  {
    id: 'board_ops',
    projectId: MOCK_PROJECT.id,
    previewAccessible: true,
    name: 'Ops Board',
    slug: 'ops',
    description: 'Infrastructure, deployment runbooks, monitoring, and security.',
  },
  {
    id: 'board_mktg',
    projectId: MOCK_PROJECT.id,
    previewAccessible: true,
    name: 'Marketing Board',
    slug: 'marketing',
    description: 'Brand assets, product launch copywriting, SEO, and social ads.',
  },
];

export const MOCK_PEOPLE: Record<string, MockPerson> = {
  alice: {
    id: 'alice',
    name: 'Alice Owner',
    initials: 'AO',
    role: 'Owner',
    avatarTone: 'bg-[#684b7c] text-white',
    email: 'alice@fashionbrand.example',
  },
  charlie: {
    id: 'charlie',
    name: 'Charlie Manager',
    initials: 'CM',
    role: 'Manager',
    avatarTone: 'bg-[#39759e] text-white',
    email: 'charlie@fashionbrand.example',
  },
  david: {
    id: 'david',
    name: 'David Member',
    initials: 'DM',
    role: 'Member',
    avatarTone: 'bg-[#a74c70] text-white',
    email: 'david@fashionbrand.example',
  },
  eve: {
    id: 'eve',
    name: 'Eve Viewer',
    initials: 'EV',
    role: 'Viewer',
    avatarTone: 'bg-[#77588b] text-white',
    email: 'eve@fashionbrand.example',
  },
};

export const MOCK_COLUMNS = [
  { id: 'col_todo', name: 'To Do', category: 'todo', tone: 'backlog' },
  { id: 'col_progress', name: 'In Progress', category: 'active', tone: 'progress' },
  { id: 'col_done', name: 'Done', category: 'done', tone: 'completed' },
] as const;

export const INITIAL_MOCK_CARDS: MockCard[] = [
  // Developers Board Cards
  {
    id: 'card_dev_101',
    key: 'DEV-101',
    title: 'Scaffold Next.js App Router and Tailwind tokens',
    description: 'Set up apps/web with TypeScript, pastel green completed states, and Radix dialogs.',
    boardId: 'board_dev',
    boardName: 'Developers Board',
    columnId: 'col_progress',
    priority: 'high',
    assigneeIds: ['charlie', 'david'],
    dueDate: '2026-10-30',
    commentCount: 4,
    imageCount: 1,
    taskCount: { completed: 3, total: 4 },
    tags: ['Frontend', 'Next.js'],
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'card_dev_102',
    key: 'DEV-102',
    title: 'Migrate PostgreSQL schema with idempotency checks',
    description: 'Ensure all mutations verify structureVersion and prevent replay collisions.',
    boardId: 'board_dev',
    boardName: 'Developers Board',
    columnId: 'col_done',
    priority: 'urgent',
    assigneeIds: ['alice'],
    dueDate: '2026-10-27',
    commentCount: 2,
    imageCount: 0,
    taskCount: { completed: 5, total: 5 },
    tags: ['Database', 'Postgres'],
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
  {
    id: 'card_dev_103',
    key: 'DEV-103',
    title: 'Implement optimistic card reordering with dnd-kit',
    description: 'Support pointer, keyboard, and touch navigation with accessible Move dialog fallback.',
    boardId: 'board_dev',
    boardName: 'Developers Board',
    columnId: 'col_todo',
    priority: 'medium',
    assigneeIds: ['david'],
    dueDate: '2026-11-04',
    commentCount: 1,
    imageCount: 0,
    taskCount: { completed: 0, total: 3 },
    tags: ['Accessibility', 'A11y'],
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },

  // Ops Board Cards
  {
    id: 'card_ops_201',
    key: 'OPS-201',
    title: 'Configure Cloudflare Workers custom domain & SSL',
    description: 'Provision edge routing rules, verify CORS headers, and enable caching rules.',
    boardId: 'board_ops',
    boardName: 'Ops Board',
    columnId: 'col_todo',
    priority: 'high',
    assigneeIds: ['charlie'],
    dueDate: '2026-11-01',
    commentCount: 0,
    imageCount: 0,
    taskCount: { completed: 1, total: 4 },
    tags: ['Infra', 'Edge'],
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 16).toISOString(),
  },
  {
    id: 'card_ops_202',
    key: 'OPS-202',
    title: 'Set up Automated 24h Card Trash Purge Cron',
    description: 'Run background worker to permanently purge cards after the 24-hour restore window.',
    boardId: 'board_ops',
    boardName: 'Ops Board',
    columnId: 'col_done',
    priority: 'medium',
    assigneeIds: ['alice', 'charlie'],
    dueDate: '2026-10-26',
    commentCount: 3,
    imageCount: 1,
    taskCount: { completed: 2, total: 2 },
    tags: ['Cron', 'Storage'],
    createdAt: new Date(Date.now() - 3600000 * 96).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 30).toISOString(),
  },
  {
    id: 'card_ops_203',
    key: 'OPS-203',
    title: 'Production health monitoring and alerting webhooks',
    description: 'Connect /health/ready probe to Slack alerts for database degradation notices.',
    boardId: 'board_ops',
    boardName: 'Ops Board',
    columnId: 'col_progress',
    priority: 'low',
    assigneeIds: ['david'],
    dueDate: '2026-11-05',
    commentCount: 1,
    imageCount: 0,
    taskCount: { completed: 1, total: 3 },
    tags: ['Monitoring'],
    createdAt: new Date(Date.now() - 3600000 * 36).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
  },

  // Marketing Board Cards
  {
    id: 'card_mkt_301',
    key: 'MKT-301',
    title: 'Finalize Autumn Lookbook photography & color palette',
    description: 'Curate high-resolution hero imagery adhering to the private image access policies.',
    boardId: 'board_mktg',
    boardName: 'Marketing Board',
    columnId: 'col_progress',
    priority: 'urgent',
    assigneeIds: ['alice', 'david'],
    dueDate: '2026-10-29',
    commentCount: 7,
    imageCount: 3,
    taskCount: { completed: 4, total: 6 },
    tags: ['Creative', 'Assets'],
    createdAt: new Date(Date.now() - 3600000 * 60).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 'card_mkt_302',
    key: 'MKT-302',
    title: 'Review brand fashion typography and style guide',
    description: 'Audit font sizing, tabular figures, and dark mode contrast tokens across all screens.',
    boardId: 'board_mktg',
    boardName: 'Marketing Board',
    columnId: 'col_done',
    priority: 'medium',
    assigneeIds: ['david'],
    dueDate: '2026-10-25',
    commentCount: 2,
    imageCount: 2,
    taskCount: { completed: 3, total: 3 },
    tags: ['Design', 'Brand'],
    createdAt: new Date(Date.now() - 3600000 * 120).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 40).toISOString(),
  },
  {
    id: 'card_mkt_303',
    key: 'MKT-303',
    title: 'Draft press release and customer newsletter launch copy',
    description: 'Highlight unified multi-board visibility, fast performance, and collaborative workflows.',
    boardId: 'board_mktg',
    boardName: 'Marketing Board',
    columnId: 'col_todo',
    priority: 'low',
    assigneeIds: ['charlie'],
    dueDate: '2026-11-08',
    commentCount: 0,
    imageCount: 0,
    taskCount: { completed: 0, total: 2 },
    tags: ['Copywriting'],
    createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 18).toISOString(),
  },
];
