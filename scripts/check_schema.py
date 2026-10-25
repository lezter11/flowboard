#!/usr/bin/env python3
"""Historical D1 prototype checks; not PostgreSQL or deployed-runtime evidence."""
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
NOW = '2026-10-26T00:00:00Z'


class SchemaChecks(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript((ROOT / 'database/prototypes/d1/migrations/0001_initial.sql').read_text())
        for user in ('alice', 'bob', 'outsider'):
            self.db.execute('INSERT INTO users VALUES (?, ?, ?)', (user, user, NOW))
        for workspace, owner in (('w1', 'alice'), ('w2', 'outsider')):
            self.db.execute('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)',
                            (workspace, workspace, 'Asia/Kolkata', owner, NOW))
            self.db.execute('INSERT INTO memberships VALUES (?, ?, ?, ?, ?, ?)',
                            (workspace, owner, 'owner', 'active', 1, NOW))
        self.db.execute('INSERT INTO memberships VALUES (?, ?, ?, ?, ?, ?)',
                        ('w1', 'bob', 'member', 'active', 1, NOW))
        for workspace, suffix in (('w1', '1'), ('w2', '2'), ('w1', '3')):
            self.db.execute('INSERT INTO projects VALUES (?, ?, ?, ?)',
                            ('p' + suffix, workspace, 'Project', NOW))
            self.db.execute('INSERT INTO boards VALUES (?, ?, ?, ?, ?, ?, ?)',
                            ('b' + suffix, workspace, 'p' + suffix, 'Board', 1, 1, NOW))
            self.db.execute('INSERT INTO board_columns VALUES (?, ?, ?, ?, ?, ?, ?)',
                            ('c' + suffix, workspace, 'b' + suffix, 'Todo', 'todo', None, 1024))
        self.db.execute('''INSERT INTO cards
            (id, workspace_id, board_id, column_id, title, position, creator_id, created_at, updated_at)
            VALUES ('card', 'w1', 'b1', 'c1', 'Synthetic task', 1024, 'alice', ?, ?)''', (NOW, NOW))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def rejected(self, sql, params=()):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(sql, params)
        self.db.rollback()

    def test_cross_workspace_and_cross_board_columns_rejected(self):
        self.rejected("UPDATE cards SET column_id='c2' WHERE id='card'")
        self.rejected("UPDATE cards SET column_id='c3' WHERE id='card'")
        self.rejected("UPDATE boards SET project_id='p2' WHERE id='b1'")

    def test_assignment_membership_scope_and_duplicates(self):
        self.rejected("INSERT INTO card_assignees VALUES ('w1', 'card', 'outsider')")
        self.db.execute("INSERT INTO card_assignees VALUES ('w1', 'card', 'bob')")
        self.db.commit()
        self.rejected("INSERT INTO card_assignees VALUES ('w1', 'card', 'bob')")

    def test_comment_and_mention_scope(self):
        self.db.execute('INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        ('comment', 'w1', 'card', 'alice', 'Hi @Bob', 1, None, NOW, NOW))
        self.db.commit()
        self.rejected("INSERT INTO comment_mentions VALUES ('w1', 'comment', 'outsider', 3, 7)")
        self.rejected("INSERT INTO comment_mentions VALUES ('w1', 'comment', 'bob', 7, 3)")
        self.db.execute("INSERT INTO comment_mentions VALUES ('w1', 'comment', 'bob', 3, 7)")

    def test_card_validation_and_nonempty_column(self):
        self.rejected("UPDATE cards SET title='  ' WHERE id='card'")
        self.rejected("UPDATE cards SET priority='critical' WHERE id='card'")
        self.rejected("UPDATE cards SET version=0 WHERE id='card'")
        self.rejected("UPDATE cards SET due_date='tomorrow' WHERE id='card'")
        self.rejected("DELETE FROM board_columns WHERE id='c1'")
        self.db.execute("UPDATE cards SET due_date='2026-12-31' WHERE id='card'")
        self.assertEqual(self.db.execute("SELECT due_date FROM cards").fetchone()[0], '2026-12-31')

    def event(self, event_id='event', board='b1'):
        self.db.execute('INSERT INTO activity_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        (event_id, 'w1', board, 'card', 'alice', 'card.updated', '{}', NOW))

    def test_event_scope_and_notification_deduplication(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.event('wrong-board', 'b3')
        self.db.rollback()
        self.event()
        self.db.execute('INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?)',
                        ('n1', 'w1', 'event', 'bob', None, NOW))
        self.db.commit()
        self.rejected('INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?)',
                      ('n2', 'w1', 'event', 'bob', None, NOW))
        self.rejected('INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?)',
                      ('n3', 'w1', 'event', 'outsider', None, NOW))

    def test_receipt_and_owner_uniqueness(self):
        params = ('w1', 'alice', 'key', 'hash', 200, '{}', NOW, '2026-11-02T00:00:00Z')
        self.db.execute('INSERT INTO idempotency_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params)
        self.db.commit()
        self.rejected('INSERT INTO idempotency_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params)
        self.rejected("UPDATE memberships SET role='owner' WHERE workspace_id='w1' AND user_id='bob'")

    def test_actor_receipt_without_workspace_membership(self):
        self.db.execute('INSERT INTO users VALUES (?, ?, ?)', ('new-user', 'New', NOW))
        params = ('new-user', 'create-key', 'hash', 201, '{}', NOW, '2026-11-02T00:00:00Z')
        self.db.execute('INSERT INTO actor_operation_receipts VALUES (?, ?, ?, ?, ?, ?, ?)', params)
        self.db.commit()
        self.rejected('INSERT INTO actor_operation_receipts VALUES (?, ?, ?, ?, ?, ?, ?)', params)

    def guarded_move(self, expected, token):
        self.db.execute('''UPDATE boards SET structure_version=structure_version+1
            WHERE id='b1' AND structure_version=?
            AND EXISTS (SELECT 1 FROM memberships WHERE workspace_id='w1'
                        AND user_id='alice' AND status='active' AND role IN ('owner','admin','member'))''',
                        (expected,))
        self.db.execute('INSERT INTO mutation_guards VALUES (?, changes())', (token,))
        self.db.execute("UPDATE cards SET position=2048, version=version+1 WHERE id='card'")
        self.event(token)
        self.db.execute('DELETE FROM mutation_guards WHERE token=?', (token,))

    def test_success_then_stale_guard_rolls_back(self):
        with self.db:
            self.guarded_move(1, 'winner')
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.guarded_move(1, 'stale')
        self.assertEqual(self.db.execute('SELECT structure_version FROM boards WHERE id=\'b1\'').fetchone()[0], 2)
        self.assertEqual(self.db.execute('SELECT version FROM cards').fetchone()[0], 2)
        self.assertEqual(self.db.execute('SELECT count(*) FROM activity_events').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM mutation_guards').fetchone()[0], 0)

    def test_later_failure_rolls_back_earlier_board_guard(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.guarded_move(1, 'rollback')
                self.db.execute("UPDATE cards SET column_id='c2' WHERE id='card'")
        self.assertEqual(self.db.execute('SELECT structure_version FROM boards WHERE id=\'b1\'').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT version FROM cards').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM activity_events').fetchone()[0], 0)

    def test_revoked_membership_fails_write_guard(self):
        self.db.execute("UPDATE memberships SET status='removed' WHERE workspace_id='w1' AND user_id='alice'")
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.guarded_move(1, 'revoked')
        self.assertEqual(self.db.execute('SELECT count(*) FROM activity_events').fetchone()[0], 0)

    def test_foreign_key_consistency(self):
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
