import type {
  Board,
  BoardSnapshotData,
  Card,
  CardSummary,
  Column,
  Comment,
  FinalizedImage,
  ImageUpload,
  ImportRow,
  ImportStatus,
  PersonDisplay,
  Project,
  ProjectMember,
  TrashRow,
  Workspace,
} from '../index.ts';

// -----------------------------------------------------------------------------
// Canonical Synthetic Users & Person Displays
// -----------------------------------------------------------------------------
export const FIXTURE_USERS = {
  alice: {
    id: 'usr_alice_owner_w1',
    email: 'alice@example.com',
    displayName: 'Alice Owner',
    avatarUrl: 'https://images.example.com/avatars/alice.png',
  },
  bob: {
    id: 'usr_bob_owner_w2',
    email: 'bob@example.com',
    displayName: 'Bob Owner',
    avatarUrl: 'https://images.example.com/avatars/bob.png',
  },
  charlie: {
    id: 'usr_charlie_manager',
    email: 'charlie@example.com',
    displayName: 'Charlie Manager',
    avatarUrl: 'https://images.example.com/avatars/charlie.png',
  },
  david: {
    id: 'usr_david_member',
    email: 'david@example.com',
    displayName: 'David Member',
    avatarUrl: null,
  },
  eve: {
    id: 'usr_eve_viewer',
    email: 'eve@example.com',
    displayName: 'Eve Viewer',
    avatarUrl: null,
  },
  frank: {
    id: 'usr_frank_manager_ops',
    email: 'frank@example.com',
    displayName: 'Frank Ops Manager',
    avatarUrl: null,
  },
  mallory: {
    id: 'usr_mallory_removed',
    email: 'mallory@example.com',
    displayName: 'Mallory Former',
    avatarUrl: null,
  },
} as const;

export const FIXTURE_PEOPLE = {
  aliceOwner: {
    id: FIXTURE_USERS.alice.id,
    displayName: FIXTURE_USERS.alice.displayName,
    avatarUrl: FIXTURE_USERS.alice.avatarUrl,
    activeInProject: true,
    scopedRole: 'owner',
    assignable: true,
    mentionable: true,
  } satisfies PersonDisplay,
  charlieManager: {
    id: FIXTURE_USERS.charlie.id,
    displayName: FIXTURE_USERS.charlie.displayName,
    avatarUrl: FIXTURE_USERS.charlie.avatarUrl,
    activeInProject: true,
    scopedRole: 'manager',
    assignable: true,
    mentionable: true,
  } satisfies PersonDisplay,
  davidMember: {
    id: FIXTURE_USERS.david.id,
    displayName: FIXTURE_USERS.david.displayName,
    avatarUrl: FIXTURE_USERS.david.avatarUrl,
    activeInProject: true,
    scopedRole: 'member',
    assignable: true,
    mentionable: true,
  } satisfies PersonDisplay,
  eveViewer: {
    id: FIXTURE_USERS.eve.id,
    displayName: FIXTURE_USERS.eve.displayName,
    avatarUrl: FIXTURE_USERS.eve.avatarUrl,
    activeInProject: true,
    scopedRole: 'viewer',
    assignable: false,
    mentionable: true,
  } satisfies PersonDisplay,
  malloryRemoved: {
    id: FIXTURE_USERS.mallory.id,
    displayName: FIXTURE_USERS.mallory.displayName,
    avatarUrl: FIXTURE_USERS.mallory.avatarUrl,
    activeInProject: false,
    scopedRole: 'member',
    assignable: false,
    mentionable: false,
  } satisfies PersonDisplay,
} as const;

// -----------------------------------------------------------------------------
// Two Workspaces: Acme Corp (Alice) and Beta Global (Bob)
// -----------------------------------------------------------------------------
const acmeWorkspace: Workspace = {
  id: 'ws_acme_corp',
  name: 'Acme Corp',
  timezone: 'America/New_York',
  ownerId: FIXTURE_USERS.alice.id,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const betaWorkspace: Workspace = {
  id: 'ws_beta_global',
  name: 'Beta Global',
  timezone: 'Europe/London',
  ownerId: FIXTURE_USERS.bob.id,
  version: 1,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

export const FIXTURE_WORKSPACES = {
  acme: acmeWorkspace,
  beta: betaWorkspace,
} as const;

// -----------------------------------------------------------------------------
// Sibling Projects in Acme: Website Redesign vs Internal Operations
// + Project C in Beta Global (where Alice is invited as a member)
// -----------------------------------------------------------------------------
const websiteProject: Project = {
  id: 'prj_website_redesign',
  workspaceId: acmeWorkspace.id,
  name: 'Website Redesign',
  description: 'Public marketing website refresh',
  isArchived: false,
  version: 2,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const operationsProject: Project = {
  id: 'prj_internal_operations',
  workspaceId: acmeWorkspace.id,
  name: 'Internal Operations',
  description: 'Internal tooling and operational procedures',
  isArchived: false,
  version: 1,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};

const betaClientProject: Project = {
  id: 'prj_beta_client',
  workspaceId: betaWorkspace.id,
  name: 'Client Project C',
  description: 'External collaborative workspace',
  isArchived: false,
  version: 1,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

export const FIXTURE_PROJECTS = {
  website: websiteProject,
  operations: operationsProject,
  betaClient: betaClientProject,
} as const;

// -----------------------------------------------------------------------------
// Project Memberships: Sibling Project Privacy & Historical Removed User
// -----------------------------------------------------------------------------
export const FIXTURE_MEMBERSHIPS: ProjectMember[] = [
  // Website Redesign members
  {
    id: 'mem_web_charlie',
    projectId: websiteProject.id,
    userId: FIXTURE_USERS.charlie.id,
    role: 'manager',
    status: 'active',
    version: 1,
    createdAt: '2026-10-05T01:00:00.000Z',
    updatedAt: '2026-10-05T01:00:00.000Z',
  },
  {
    id: 'mem_web_david',
    projectId: websiteProject.id,
    userId: FIXTURE_USERS.david.id,
    role: 'member',
    status: 'active',
    version: 1,
    createdAt: '2026-10-05T02:00:00.000Z',
    updatedAt: '2026-10-05T02:00:00.000Z',
  },
  {
    id: 'mem_web_eve',
    projectId: websiteProject.id,
    userId: FIXTURE_USERS.eve.id,
    role: 'viewer',
    status: 'active',
    version: 1,
    createdAt: '2026-10-05T03:00:00.000Z',
    updatedAt: '2026-10-05T03:00:00.000Z',
  },
  {
    id: 'mem_web_mallory',
    projectId: websiteProject.id,
    userId: FIXTURE_USERS.mallory.id,
    role: 'member',
    status: 'removed', // Removed user!
    version: 2,
    createdAt: '2026-10-05T04:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  },
  // Internal Operations: Charlie and David do NOT exist here!
  {
    id: 'mem_ops_frank',
    projectId: operationsProject.id,
    userId: FIXTURE_USERS.frank.id,
    role: 'manager',
    status: 'active',
    version: 1,
    createdAt: '2026-10-06T01:00:00.000Z',
    updatedAt: '2026-10-06T01:00:00.000Z',
  },
  // Beta Client: Alice is a member here (owner invited elsewhere)
  {
    id: 'mem_beta_alice',
    projectId: betaClientProject.id,
    userId: FIXTURE_USERS.alice.id,
    role: 'member',
    status: 'active',
    version: 1,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
  },
];

// -----------------------------------------------------------------------------
// Boards & Columns (including a Read-Only Archived Board)
// -----------------------------------------------------------------------------
const mainKanbanBoard: Board = {
  id: 'brd_main_kanban',
  workspaceId: acmeWorkspace.id,
  projectId: websiteProject.id,
  name: 'Website Kanban',
  isArchived: false,
  structureVersion: 4,
  snapshotVersion: 12,
  createdAt: '2026-10-05T00:30:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
};

const archivedBoard: Board = {
  id: 'brd_q3_retrospective',
  workspaceId: acmeWorkspace.id,
  projectId: websiteProject.id,
  name: 'Q3 Retrospective (Read-Only)',
  isArchived: true, // Archived / Read-Only!
  structureVersion: 2,
  snapshotVersion: 5,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-09-30T23:59:59.000Z',
};

export const FIXTURE_BOARDS = {
  mainKanban: mainKanbanBoard,
  archivedBoard: archivedBoard,
} as const;

export const FIXTURE_COLUMNS: Column[] = [
  {
    id: 'col_not_started',
    boardId: mainKanbanBoard.id,
    name: 'Not started',
    category: 'todo',
    color: '#6B7280',
    position: 1000,
    activeCardCount: 3,
    matchingCardCount: 3,
    createdAt: '2026-10-05T00:35:00.000Z',
    updatedAt: '2026-10-05T00:35:00.000Z',
  },
  {
    id: 'col_in_progress',
    boardId: mainKanbanBoard.id,
    name: 'In progress',
    category: 'active',
    color: '#3B82F6',
    position: 2000,
    activeCardCount: 2,
    matchingCardCount: 2,
    createdAt: '2026-10-05T00:35:00.000Z',
    updatedAt: '2026-10-05T00:35:00.000Z',
  },
  {
    id: 'col_testing',
    boardId: mainKanbanBoard.id,
    name: 'Testing',
    category: 'active',
    color: '#F59E0B',
    position: 3000,
    activeCardCount: 1,
    matchingCardCount: 1,
    createdAt: '2026-10-05T00:35:00.000Z',
    updatedAt: '2026-10-05T00:35:00.000Z',
  },
  {
    id: 'col_completed',
    boardId: mainKanbanBoard.id,
    name: 'Completed',
    category: 'done',
    color: '#10B981',
    position: 4000,
    activeCardCount: 5,
    matchingCardCount: 5,
    createdAt: '2026-10-05T00:35:00.000Z',
    updatedAt: '2026-10-05T00:35:00.000Z',
  },
];

// -----------------------------------------------------------------------------
// Cards (Active, Summaries, Historical Authors, Comment/Attachment counts)
// -----------------------------------------------------------------------------
const heroBannerCard: Card = {
  id: 'crd_hero_banner',
  workspaceId: acmeWorkspace.id,
  projectId: websiteProject.id,
  boardId: mainKanbanBoard.id,
  columnId: 'col_in_progress',
  title: 'Implement dynamic hero banner animation',
  description: 'Ensure smooth 60fps framerate across desktop and mobile browsers.',
  priority: 'high',
  dueDate: '2026-11-15',
  assigneeIds: [FIXTURE_USERS.david.id],
  position: 1000,
  version: 3,
  state: 'active',
  deletedAt: null,
  deletedBy: null,
  restoreUntil: null,
  commentCount: 4,
  imageCount: 2,
  createdAt: '2026-10-10T14:00:00.000Z',
  updatedAt: '2026-10-25T16:30:00.000Z',
};

const footerLinksCard: Card = {
  id: 'crd_footer_links',
  workspaceId: acmeWorkspace.id,
  projectId: websiteProject.id,
  boardId: mainKanbanBoard.id,
  columnId: 'col_not_started',
  title: 'Update footer privacy links',
  description: 'Review compliance with updated cookie policy.',
  priority: 'low',
  dueDate: null,
  assigneeIds: [],
  position: 1000,
  version: 1,
  state: 'active',
  deletedAt: null,
  deletedBy: null,
  restoreUntil: null,
  commentCount: 0,
  imageCount: 0,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

export const FIXTURE_CARDS = {
  heroBanner: heroBannerCard,
  footerLinks: footerLinksCard,
} as const;

export const FIXTURE_CARD_SUMMARIES: CardSummary[] = [
  {
    id: heroBannerCard.id,
    boardId: mainKanbanBoard.id,
    columnId: heroBannerCard.columnId,
    title: heroBannerCard.title,
    priority: heroBannerCard.priority,
    dueDate: heroBannerCard.dueDate,
    assigneeIds: heroBannerCard.assigneeIds,
    position: heroBannerCard.position,
    version: heroBannerCard.version,
    commentCount: heroBannerCard.commentCount,
    imageCount: heroBannerCard.imageCount,
    createdAt: heroBannerCard.createdAt,
    updatedAt: heroBannerCard.updatedAt,
  },
  {
    id: footerLinksCard.id,
    boardId: mainKanbanBoard.id,
    columnId: footerLinksCard.columnId,
    title: footerLinksCard.title,
    priority: footerLinksCard.priority,
    dueDate: footerLinksCard.dueDate,
    assigneeIds: footerLinksCard.assigneeIds,
    position: footerLinksCard.position,
    version: footerLinksCard.version,
    commentCount: footerLinksCard.commentCount,
    imageCount: footerLinksCard.imageCount,
    createdAt: footerLinksCard.createdAt,
    updatedAt: footerLinksCard.updatedAt,
  },
];

// -----------------------------------------------------------------------------
// Comments & Mentions (including historical author who has been removed)
// -----------------------------------------------------------------------------
export const FIXTURE_COMMENTS: Comment[] = [
  {
    id: 'cmt_001_initial_feedback',
    projectId: websiteProject.id,
    cardId: heroBannerCard.id,
    authorId: FIXTURE_USERS.mallory.id, // Mallory was author before removal!
    body: 'Initial layout draft uploaded for review.',
    mentions: [],
    version: 1,
    deletedAt: null,
    createdAt: '2026-10-11T10:00:00.000Z',
    updatedAt: '2026-10-11T10:00:00.000Z',
    author: FIXTURE_PEOPLE.malloryRemoved,
  },
  {
    id: 'cmt_002_david_mention',
    projectId: websiteProject.id,
    cardId: heroBannerCard.id,
    authorId: FIXTURE_USERS.charlie.id,
    body: 'Hey @David, please make sure the mobile framerate is tested.',
    mentions: [
      {
        userId: FIXTURE_USERS.david.id,
        start: 4,
        end: 10,
      },
    ],
    version: 1,
    deletedAt: null,
    createdAt: '2026-10-12T11:00:00.000Z',
    updatedAt: '2026-10-12T11:00:00.000Z',
    author: FIXTURE_PEOPLE.charlieManager,
  },
];

// -----------------------------------------------------------------------------
// Finalized Images & In-Progress Uploads
// -----------------------------------------------------------------------------
export const FIXTURE_IMAGES: FinalizedImage[] = [
  {
    id: 'img_hero_mockup_desktop',
    projectId: websiteProject.id,
    cardId: heroBannerCard.id,
    filename: 'hero-desktop.png',
    byteLength: 1_048_576, // 1 MiB
    contentType: 'image/png',
    width: 1920,
    height: 1080,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    uploaderId: FIXTURE_USERS.david.id,
    version: 1,
    createdAt: '2026-10-12T10:30:00.000Z',
  },
];

export const FIXTURE_UPLOADS: ImageUpload[] = [
  {
    id: 'upl_in_progress_stage',
    projectId: websiteProject.id,
    cardId: heroBannerCard.id,
    version: 1,
    state: 'validating',
    expectedBytes: 524_288,
    receivedBytes: 524_288,
    expiresAt: '2026-10-26T22:00:00.000Z',
    serverNow: '2026-10-26T20:50:00.000Z',
    finalizedImageId: null,
    error: null,
  },
];

// -----------------------------------------------------------------------------
// Trash Rows: Exact 24h Cutoff & Expired Window
// -----------------------------------------------------------------------------
export const FIXTURE_TRASH: TrashRow[] = [
  {
    // Restorable card: deleted 2 hours ago, restore window is active
    id: 'crd_trashed_recent',
    title: 'Outdated competitor benchmark',
    projectId: websiteProject.id,
    boardId: mainKanbanBoard.id,
    originalColumnId: 'col_not_started',
    version: 2,
    structureVersion: 4,
    deletedAt: '2026-10-26T18:00:00.000Z',
    deletedBy: FIXTURE_USERS.charlie.id,
    restoreUntil: '2026-10-27T18:00:00.000Z', // exactly +24h
    canRestore: true,
    blockedReason: null,
  },
  {
    // Expired card: deleted 48 hours ago, window expired
    id: 'crd_trashed_expired',
    title: 'Deprecated legacy draft',
    projectId: websiteProject.id,
    boardId: mainKanbanBoard.id,
    originalColumnId: 'col_not_started',
    version: 1,
    structureVersion: 3,
    deletedAt: '2026-10-24T10:00:00.000Z',
    deletedBy: FIXTURE_USERS.charlie.id,
    restoreUntil: '2026-10-25T10:00:00.000Z', // past!
    canRestore: false,
    blockedReason: 'window_expired',
  },
];

// -----------------------------------------------------------------------------
// Excel Import Status & Rows (repeated import, new, conflict)
// -----------------------------------------------------------------------------
export const FIXTURE_IMPORT_ROWS: ImportRow[] = [
  {
    rowNumber: 2,
    externalId: 'EXT-001',
    title: 'Setup automated deployment script',
    status: 'In progress',
    priority: 'high',
    dueDate: '2026-11-01',
    assigneeIds: [FIXTURE_USERS.david.id],
    outcome: 'already_imported', // Repeated import!
    errors: [],
    cardId: 'crd_ext_001_previously_created',
  },
  {
    rowNumber: 3,
    externalId: 'EXT-002',
    title: 'Add accessibility audits to PR check',
    status: 'Not started',
    priority: 'medium',
    dueDate: null,
    assigneeIds: [],
    outcome: 'new', // Clean new card to create
    errors: [],
    cardId: null,
  },
  {
    rowNumber: 4,
    externalId: 'EXT-003',
    title: 'Conflicting description and priority',
    status: 'Testing',
    priority: 'urgent',
    dueDate: '2026-12-01',
    assigneeIds: [],
    outcome: 'conflict', // Changed payload for existing External ID!
    errors: [
      {
        field: 'External ID',
        code: 'CONFLICT',
        message: 'Row data differs from previously imported row with the same External ID',
      },
    ],
    cardId: null,
  },
];

export const FIXTURE_IMPORT_STATUS: ImportStatus = {
  id: 'imp_batch_website_20261026',
  projectId: websiteProject.id,
  boardId: mainKanbanBoard.id,
  defaultColumnId: 'col_not_started',
  version: 1,
  state: 'invalid', // Contains a conflict row, so not ready to commit
  previewDigest: 'b3f548a3e9c60e9a7e8e5d0a64738210abcde9876543210fedcba09876543210',
  expiresAt: '2026-10-26T21:30:00.000Z',
  serverNow: '2026-10-26T21:00:00.000Z',
  counts: {
    total: 3,
    new: 1,
    existing: 1,
    invalid: 0,
    conflict: 1,
    created: 0,
    skipped: 0,
  },
  canCommit: false,
  cancellationAllowed: true,
  rows: FIXTURE_IMPORT_ROWS,
  nextCursor: null,
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Import contains 1 conflict row. Fix conflicting rows to commit.',
  },
};

// -----------------------------------------------------------------------------
// Board Snapshot Fixture
// -----------------------------------------------------------------------------
export const FIXTURE_BOARD_SNAPSHOT: BoardSnapshotData = {
  board: mainKanbanBoard,
  filters: {
    titleQuery: null,
    priority: null,
    assigneeId: null,
    due: null,
  },
  asOfDate: '2026-10-26',
  totals: {
    activeCardCount: 2,
    matchingCardCount: 2,
  },
  columns: [
    {
      id: FIXTURE_COLUMNS[0]?.id ?? 'col_not_started',
      name: 'Not started',
      category: 'todo',
      color: '#6B7280',
      position: 1000,
      activeCardCount: 1,
      matchingCardCount: 1,
      cards: [FIXTURE_CARD_SUMMARIES[1]!],
      nextCursor: null,
    },
    {
      id: FIXTURE_COLUMNS[1]?.id ?? 'col_in_progress',
      name: 'In progress',
      category: 'active',
      color: '#3B82F6',
      position: 2000,
      activeCardCount: 1,
      matchingCardCount: 1,
      cards: [FIXTURE_CARD_SUMMARIES[0]!],
      nextCursor: null,
    },
  ],
  people: [
    FIXTURE_PEOPLE.aliceOwner,
    FIXTURE_PEOPLE.charlieManager,
    FIXTURE_PEOPLE.davidMember,
    FIXTURE_PEOPLE.eveViewer,
  ],
};
