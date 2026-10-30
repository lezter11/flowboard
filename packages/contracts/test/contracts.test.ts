import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidGregorianDate,
  dateOnlySchema,
  nullableDateOnlySchema,
  utcIsoTimestampSchema,
  idempotencyKeySchema,
  personDisplaySchema,
  standardErrorCodeSchema,
  errorEnvelopeSchema,
  mutationResponseSchema,
  createWorkspaceInputSchema,
  updateWorkspaceInputSchema,
  transferWorkspaceOwnershipInputSchema,
  createProjectInputSchema,
  updateProjectInputSchema,
  updateProjectMemberInputSchema,
  createInvitationInputSchema,
  acceptInvitationInputSchema,
  createBoardInputSchema,
  createColumnInputSchema,
  updateColumnInputSchema,
  reorderColumnsInputSchema,
  placementInputSchema,
  createCardInputSchema,
  updateCardInputSchema,
  moveCardInputSchema,
  postCommentInputSchema,
  editCommentInputSchema,
  mentionsListSchema,
  createImageUploadInputSchema,
  softDeleteCardInputSchema,
  restoreCardInputSchema,
  trashRowSchema,
  trashListResponseSchema,
  restoreWindowExpiredDetailsSchema,
  restoreDestinationRequiredDetailsSchema,
  readOnlyContextDetailsSchema,
  commitImportInputSchema,
  updateImportMappingsInputSchema,
  importRowSchema,
  importStatusSchema,
  boardSnapshotDataSchema,
  boardSnapshotResponseSchema,
  getSessionResponseSchema,
  logoutResponseSchema,
  parseOrThrow,
  safeParse,
  formatZodError,
  ValidationError,
} from '../src/index.ts';
import {
  FIXTURE_USERS,
  FIXTURE_PEOPLE,
  FIXTURE_WORKSPACES,
  FIXTURE_PROJECTS,
  FIXTURE_MEMBERSHIPS,
  FIXTURE_BOARDS,
  FIXTURE_COLUMNS,
  FIXTURE_CARDS,
  FIXTURE_CARD_SUMMARIES,
  FIXTURE_COMMENTS,
  FIXTURE_IMAGES,
  FIXTURE_UPLOADS,
  FIXTURE_TRASH,
  FIXTURE_IMPORT_ROWS,
  FIXTURE_IMPORT_STATUS,
  FIXTURE_BOARD_SNAPSHOT,
} from '../src/fixtures/index.ts';
import { OPENAPI_ROUTES, OPENAPI_SPEC_METADATA } from '../src/openapi/index.ts';

describe('Contracts Schema Validation Tests', () => {
  describe('Gregorian Date Validation', () => {
    it('validates leap years and non-leap years accurately', () => {
      assert.strictEqual(isValidGregorianDate('2024-02-29'), true); // 2024 is leap
      assert.strictEqual(isValidGregorianDate('2026-02-28'), true);
      assert.strictEqual(isValidGregorianDate('2026-02-29'), false); // 2026 not leap
      assert.strictEqual(isValidGregorianDate('2000-02-29'), true); // 2000 is leap (400-year)
      assert.strictEqual(isValidGregorianDate('1900-02-29'), false); // 1900 not leap (100-year)
      assert.strictEqual(isValidGregorianDate('2026-04-30'), true);
      assert.strictEqual(isValidGregorianDate('2026-04-31'), false); // April has 30 days
      assert.strictEqual(isValidGregorianDate('2026-12-31'), true);
      assert.strictEqual(isValidGregorianDate('2026-12-32'), false);
      assert.strictEqual(isValidGregorianDate('2026-13-01'), false);
      assert.strictEqual(isValidGregorianDate('2026-00-10'), false);
      assert.strictEqual(isValidGregorianDate('invalid-string'), false);
    });

    it('parses valid date-only strings and rejects invalid ones via Zod', () => {
      assert.strictEqual(dateOnlySchema.parse('2026-10-26'), '2026-10-26');
      assert.throws(() => dateOnlySchema.parse('2026-02-29'));
      assert.throws(() => dateOnlySchema.parse('invalid-date'));
      assert.strictEqual(nullableDateOnlySchema.parse(null), null);
      assert.strictEqual(nullableDateOnlySchema.parse('2026-10-26'), '2026-10-26');
    });
  });

  describe('UTC ISO Timestamps', () => {
    it('accepts UTC timestamps ending in Z with ISO representation', () => {
      const valid = '2026-10-26T20:50:00.000Z';
      assert.strictEqual(utcIsoTimestampSchema.parse(valid), valid);
    });

    it('rejects timestamps with local timezone offsets or missing Z', () => {
      assert.throws(() => utcIsoTimestampSchema.parse('2026-10-26T20:50:00+05:30'));
      assert.throws(() => utcIsoTimestampSchema.parse('2026-10-26 20:50:00'));
      assert.throws(() => utcIsoTimestampSchema.parse('2026-10-26T20:50:00'));
    });
  });

  describe('Idempotency Key Validation', () => {
    it('accepts valid ASCII keys between 16 and 128 characters', () => {
      const validKey = 'idem_key_1234567890';
      assert.strictEqual(idempotencyKeySchema.parse(validKey), validKey);

      const complexKey = 'req:project.board-123_abc';
      assert.strictEqual(idempotencyKeySchema.parse(complexKey), complexKey);
    });

    it('rejects short, long, or non-ASCII / forbidden characters', () => {
      assert.throws(() => idempotencyKeySchema.parse('short')); // < 16 chars
      assert.throws(() => idempotencyKeySchema.parse('a'.repeat(129))); // > 128 chars
      assert.throws(() => idempotencyKeySchema.parse('invalid spaces key!!'));
      assert.throws(() => idempotencyKeySchema.parse('emoji_key_🎉_123456'));
    });
  });

  describe('Standard Error Codes and Envelopes', () => {
    it('validates all canonical error codes', () => {
      assert.strictEqual(standardErrorCodeSchema.parse('UNAUTHORIZED'), 'UNAUTHORIZED');
      assert.strictEqual(standardErrorCodeSchema.parse('FORBIDDEN'), 'FORBIDDEN');
      assert.strictEqual(standardErrorCodeSchema.parse('STALE_VERSION'), 'STALE_VERSION');
      assert.strictEqual(standardErrorCodeSchema.parse('RESTORE_WINDOW_EXPIRED'), 'RESTORE_WINDOW_EXPIRED');
      assert.strictEqual(standardErrorCodeSchema.parse('VALIDATION_ERROR'), 'VALIDATION_ERROR');
    });

    it('validates standard error envelope', () => {
      const env = {
        error: {
          code: 'STALE_VERSION',
          message: 'The resource has been modified by another user.',
          requestId: 'req_123456789',
          details: { currentVersion: 4, expectedVersion: 3 },
        },
      };
      assert.deepStrictEqual(errorEnvelopeSchema.parse(env), env);
    });

    it('validates mutation responses with receipts and replayed boolean', () => {
      const mutationRes = {
        data: {
          id: 'crd_123',
          version: 2,
          structureVersion: 5,
          operationId: 'op_abc',
        },
        replayed: false,
      };
      assert.deepStrictEqual(mutationResponseSchema.parse(mutationRes), mutationRes);
    });
  });

  describe('Auth and Session Schemas', () => {
    it('validates GetSessionResponse structure', () => {
      const session = {
        data: {
          actor: FIXTURE_USERS.alice,
          ownedWorkspaces: [
            {
              id: FIXTURE_WORKSPACES.acme.id,
              name: FIXTURE_WORKSPACES.acme.name,
              timezone: FIXTURE_WORKSPACES.acme.timezone,
              version: FIXTURE_WORKSPACES.acme.version,
              createdAt: FIXTURE_WORKSPACES.acme.createdAt,
              updatedAt: FIXTURE_WORKSPACES.acme.updatedAt,
            },
          ],
          accessibleProjects: [
            {
              id: FIXTURE_PROJECTS.website.id,
              workspaceId: FIXTURE_PROJECTS.website.workspaceId,
              name: FIXTURE_PROJECTS.website.name,
              description: FIXTURE_PROJECTS.website.description,
              role: 'owner' as const,
              isArchived: false,
              version: 2,
              createdAt: FIXTURE_PROJECTS.website.createdAt,
              updatedAt: FIXTURE_PROJECTS.website.updatedAt,
            },
            {
              id: FIXTURE_PROJECTS.betaClient.id,
              workspaceId: FIXTURE_PROJECTS.betaClient.workspaceId,
              name: FIXTURE_PROJECTS.betaClient.name,
              description: FIXTURE_PROJECTS.betaClient.description,
              role: 'member' as const, // Invited elsewhere as member
              isArchived: false,
              version: 1,
              createdAt: FIXTURE_PROJECTS.betaClient.createdAt,
              updatedAt: FIXTURE_PROJECTS.betaClient.updatedAt,
            },
          ],
        },
      };
      assert.doesNotThrow(() => getSessionResponseSchema.parse(session));
    });

    it('validates LogoutResponse structure', () => {
      const res = { data: { success: true } };
      assert.deepStrictEqual(logoutResponseSchema.parse(res), res);
    });
  });

  describe('PersonDisplay Validation', () => {
    it('validates active project reader display identity', () => {
      const person = {
        id: 'usr_123',
        displayName: 'Alice Engineer',
        avatarUrl: 'https://example.com/avatar.png',
        activeInProject: true,
        scopedRole: 'owner' as const,
        assignable: true,
        mentionable: true,
      };
      assert.deepStrictEqual(personDisplaySchema.parse(person), person);
    });

    it('permits null avatarUrl and inactive project status', () => {
      const removedPerson = {
        id: 'usr_456',
        displayName: 'Bob Historical',
        avatarUrl: null,
        activeInProject: false,
      };
      const parsed = personDisplaySchema.parse(removedPerson);
      assert.strictEqual(parsed.id, 'usr_456');
      assert.strictEqual(parsed.avatarUrl, null);
      assert.strictEqual(parsed.activeInProject, false);
    });
  });

  describe('Workspace Schemas', () => {
    it('validates workspace creation input', () => {
      const input = { name: 'Acme Workspace', timezone: 'America/New_York' };
      assert.deepStrictEqual(createWorkspaceInputSchema.parse(input), input);
    });

    it('rejects empty or whitespace-only name', () => {
      assert.throws(() => createWorkspaceInputSchema.parse({ name: '   ', timezone: 'UTC' }));
    });

    it('requires at least one field in workspace update', () => {
      assert.throws(() => updateWorkspaceInputSchema.parse({ expectedVersion: 1 }));
      const validUpdate = { name: 'Updated Name', expectedVersion: 2 };
      assert.deepStrictEqual(updateWorkspaceInputSchema.parse(validUpdate), validUpdate);
    });

    it('validates ownership transfer input', () => {
      const transfer = { targetUserId: 'usr_target_123', expectedVersion: 3 };
      assert.deepStrictEqual(transferWorkspaceOwnershipInputSchema.parse(transfer), transfer);
    });
  });

  describe('Project & Membership Schemas', () => {
    it('validates project creation and update inputs', () => {
      const createInput = { name: 'New Project', description: 'Brief info' };
      assert.deepStrictEqual(createProjectInputSchema.parse(createInput), createInput);

      const updateInput = { description: null, expectedVersion: 1 };
      assert.deepStrictEqual(updateProjectInputSchema.parse(updateInput), updateInput);
    });

    it('validates member role and status updates', () => {
      const memberUpdate = {
        role: 'manager' as const,
        status: 'active' as const,
        expectedVersion: 1,
      };
      assert.deepStrictEqual(updateProjectMemberInputSchema.parse(memberUpdate), memberUpdate);
    });
  });

  describe('Invitations Schemas', () => {
    it('normalizes email to lowercase and validates role', () => {
      const invite = createInvitationInputSchema.parse({
        email: '  User@Example.Com  ',
        role: 'member',
      });
      assert.strictEqual(invite.email, 'user@example.com');
      assert.strictEqual(invite.role, 'member');
    });

    it('validates accept invitation token bounds', () => {
      const accept = acceptInvitationInputSchema.parse({
        token: 'token_1234567890abcdef',
      });
      assert.strictEqual(accept.token, 'token_1234567890abcdef');
      assert.throws(() => acceptInvitationInputSchema.parse({ token: 'short' }));
    });
  });

  describe('Board and Column Schemas', () => {
    it('validates column creation and category enum', () => {
      const col = createColumnInputSchema.parse({
        name: 'In Progress',
        color: '#3B82F6',
        category: 'active',
        expectedBoardVersion: 2,
      });
      assert.strictEqual(col.category, 'active');
      assert.strictEqual(col.name, 'In Progress');
    });

    it('enforces column reordering limits (up to 12 columns, unique IDs)', () => {
      const validOrder = {
        columnIds: ['col_1', 'col_2', 'col_3'],
        expectedBoardVersion: 3,
      };
      assert.deepStrictEqual(reorderColumnsInputSchema.parse(validOrder), validOrder);

      assert.throws(() =>
        reorderColumnsInputSchema.parse({
          columnIds: ['col_1', 'col_1'],
          expectedBoardVersion: 3,
        }),
      );

      const tooMany = Array.from({ length: 13 }, (_, i) => `col_${i}`);
      assert.throws(() =>
        reorderColumnsInputSchema.parse({
          columnIds: tooMany,
          expectedBoardVersion: 3,
        }),
      );
    });

    it('validates placement query rules (anchorCardId required for before/after)', () => {
      assert.doesNotThrow(() =>
        placementInputSchema.parse({
          movingCardId: 'crd_1',
          at: 'first',
        }),
      );

      assert.throws(() =>
        placementInputSchema.parse({
          movingCardId: 'crd_1',
          at: 'before',
        }),
      );

      assert.doesNotThrow(() =>
        placementInputSchema.parse({
          movingCardId: 'crd_1',
          at: 'before',
          anchorCardId: 'crd_anchor',
        }),
      );
    });
  });

  describe('Card Schemas', () => {
    it('validates card creation input with defaults', () => {
      const input = {
        title: 'New Feature Card',
        columnId: 'col_123',
        expectedBoardVersion: 1,
      };
      const parsed = createCardInputSchema.parse(input);
      assert.strictEqual(parsed.title, 'New Feature Card');
      assert.strictEqual(parsed.priority, 'none');
      assert.strictEqual(parsed.dueDate, null);
      assert.deepStrictEqual(parsed.assigneeIds, []);
    });

    it('rejects card with duplicate assignees or >20 assignees', () => {
      assert.throws(() =>
        createCardInputSchema.parse({
          title: 'Card',
          columnId: 'col_1',
          assigneeIds: ['usr_1', 'usr_1'],
          expectedBoardVersion: 1,
        }),
      );

      const tooMany = Array.from({ length: 21 }, (_, i) => `usr_${i}`);
      assert.throws(() =>
        createCardInputSchema.parse({
          title: 'Card',
          columnId: 'col_1',
          assigneeIds: tooMany,
          expectedBoardVersion: 1,
        }),
      );
    });

    it('validates card movement input with nullable neighbors', () => {
      const move = {
        toColumnId: 'col_done',
        previousCardId: null,
        nextCardId: 'crd_next',
        expectedVersion: 3,
        expectedBoardVersion: 7,
      };
      assert.deepStrictEqual(moveCardInputSchema.parse(move), move);
    });
  });

  describe('Discussion & Mentions', () => {
    it('validates non-overlapping mentions and defaults empty list', () => {
      const mentions = [
        { userId: 'usr_1', start: 0, end: 5 },
        { userId: 'usr_2', start: 10, end: 15 },
      ];
      assert.deepStrictEqual(mentionsListSchema.parse(mentions), mentions);

      const comment = postCommentInputSchema.parse({ body: 'Just a simple comment' });
      assert.deepStrictEqual(comment.mentions, []);
    });

    it('rejects overlapping mention spans', () => {
      const overlapping = [
        { userId: 'usr_1', start: 0, end: 10 },
        { userId: 'usr_2', start: 5, end: 15 },
      ];
      assert.throws(() => mentionsListSchema.parse(overlapping));
    });

    it('rejects mention where start >= end', () => {
      assert.throws(() =>
        mentionsListSchema.parse([{ userId: 'usr_1', start: 10, end: 5 }]),
      );
    });
  });

  describe('Image Upload Schemas', () => {
    it('validates image upload request within limits', () => {
      const valid = {
        filename: 'screenshot.png',
        byteLength: 5 * 1024 * 1024,
        contentType: 'image/png' as const,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      };
      assert.deepStrictEqual(createImageUploadInputSchema.parse(valid), valid);
    });

    it('B-14: refuses a filename with a slash, a backslash or a control character, and keeps ordinary names', () => {
      const base = {
        byteLength: 1024,
        contentType: 'image/png' as const,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      };
      for (const filename of ['sub/dir.png', 'sub\\dir.png', '../escape.png', 'bad\u0000name.png', 'tab\tname.png', 'del\u007fname.png', 'line\nbreak.png']) {
        assert.throws(() => createImageUploadInputSchema.parse({ ...base, filename }), (err: unknown) => err instanceof Error, `refused: ${JSON.stringify(filename)}`);
      }
      assert.equal(createImageUploadInputSchema.parse({ ...base, filename: '  holiday photo (2026).png  ' }).filename, 'holiday photo (2026).png');
      assert.equal(createImageUploadInputSchema.parse({ ...base, filename: 'résumé ✓.png' }).filename, 'résumé ✓.png');
    });

    it('rejects image exceeding 10 MiB limit or unsupported content type', () => {
      assert.throws(() =>
        createImageUploadInputSchema.parse({
          filename: 'huge.jpg',
          byteLength: 10 * 1024 * 1024 + 1,
          contentType: 'image/jpeg',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        }),
      );

      assert.throws(() =>
        createImageUploadInputSchema.parse({
          filename: 'document.pdf',
          byteLength: 1024,
          contentType: 'application/pdf',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        }),
      );
    });
  });

  describe('Trash and Exact 24h Window', () => {
    it('validates soft-delete and restore inputs', () => {
      const del = { expectedVersion: 2, expectedBoardVersion: 5 };
      assert.deepStrictEqual(softDeleteCardInputSchema.parse(del), del);

      const restore = { expectedVersion: 2, expectedBoardVersion: 5, toColumnId: 'col_alt' };
      assert.deepStrictEqual(restoreCardInputSchema.parse(restore), restore);
    });

    it('validates trash row representation with blocked reason', () => {
      const row = FIXTURE_TRASH[1];
      assert.ok(row);
      assert.strictEqual(row.blockedReason, 'window_expired');
      assert.strictEqual(row.canRestore, false);
      assert.doesNotThrow(() => trashRowSchema.parse(row));
    });

    it('validates special trash error detail schemas', () => {
      const expiredDetails = {
        serverNow: '2026-10-26T20:50:00.000Z',
        restoreUntil: '2026-10-25T18:00:00.000Z',
      };
      assert.doesNotThrow(() => restoreWindowExpiredDetailsSchema.parse(expiredDetails));

      const destinationRequired = {
        reason: 'destination_missing' as const,
        boardId: 'brd_123',
      };
      assert.doesNotThrow(() => restoreDestinationRequiredDetailsSchema.parse(destinationRequired));

      const readOnly = {
        reason: 'project_archived' as const,
        contextId: 'prj_123',
      };
      assert.doesNotThrow(() => readOnlyContextDetailsSchema.parse(readOnly));
    });
  });

  describe('Excel Import Schemas', () => {
    it('validates commit import input and status mapping inputs', () => {
      const commit = {
        previewDigest: 'b3f548a3e9c60e9a7e8e5d0a64738210abcde9876543210fedcba09876543210',
        defaultColumnId: 'col_default',
        expectedVersion: 1,
      };
      assert.deepStrictEqual(commitImportInputSchema.parse(commit), commit);

      const mapping = {
        mappings: { 'In Progress': 'col_active_123' },
        expectedVersion: 1,
      };
      assert.deepStrictEqual(updateImportMappingsInputSchema.parse(mapping), mapping);
    });

    it('validates import status and rows', () => {
      assert.doesNotThrow(() => importStatusSchema.parse(FIXTURE_IMPORT_STATUS));
      assert.strictEqual(FIXTURE_IMPORT_STATUS.rows[0]?.outcome, 'already_imported');
      assert.strictEqual(FIXTURE_IMPORT_STATUS.rows[2]?.outcome, 'conflict');
    });
  });

  describe('Board Snapshot Data Schema', () => {
    it('validates complete board snapshot with totals, columns, and people', () => {
      assert.doesNotThrow(() => boardSnapshotDataSchema.parse(FIXTURE_BOARD_SNAPSHOT));
      assert.doesNotThrow(() => boardSnapshotResponseSchema.parse({ data: FIXTURE_BOARD_SNAPSHOT }));
    });
  });

  describe('OpenAPI Metadata and Routes Catalog', () => {
    it('has valid OpenAPI 3.1 metadata and comprehensive route catalog', () => {
      assert.strictEqual(OPENAPI_SPEC_METADATA.openapi, '3.1.0');
      assert.ok(OPENAPI_ROUTES.length >= 30, 'Should catalog 30+ endpoints');
      const logoutRoute = OPENAPI_ROUTES.find((r) => r.path === '/session/logout');
      assert.ok(logoutRoute);
      assert.strictEqual(logoutRoute.method, 'POST');
    });
  });

  describe('Validation Error Helper', () => {
    it('formats error issues cleanly with parseOrThrow', () => {
      assert.throws(
        () => parseOrThrow(dateOnlySchema, '2026-02-29'),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.issues.length > 0);
          return true;
        },
      );
    });

    it('returns structured safeParse result on success and failure', () => {
      const success = safeParse(dateOnlySchema, '2026-10-26');
      assert.strictEqual(success.success, true);

      const fail = safeParse(dateOnlySchema, '2026-02-29');
      assert.strictEqual(fail.success, false);
      if (!fail.success) {
        const formatted = formatZodError(fail.error);
        assert.ok(formatted.length > 0);
      }
    });
  });
});
