'use client';

import React from 'react';
import { Users, ShieldCheck, Mail, UserPlus } from 'lucide-react';
import { MOCK_PEOPLE } from '@/lib/mock-data';

export default function PeoplePage() {
  const peopleList = Object.values(MOCK_PEOPLE);

  const roleBadges: Record<string, string> = {
    Owner: 'bg-purple-100 text-purple-800 border-purple-200',
    Manager: 'bg-blue-100 text-blue-800 border-blue-200',
    Member: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Viewer: 'bg-amber-100 text-amber-800 border-amber-200',
  };

  return (
    <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
            <Users className="w-6 h-6 text-accent" />
            Project People & Permissions
          </h1>
          <p className="text-xs text-muted mt-1">
            Sample project directory for Brand Fashion. Real permissions and invitations require a reviewed backend connection.
          </p>
        </div>
        <button
          type="button"
          disabled
          aria-describedby="invite-unavailable"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-[var(--accent-ink)] text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>
      <p id="invite-unavailable" className="text-xs text-muted">Invites are unavailable in this local preview. No invitation will be sent.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {peopleList.map((person) => (
          <div
            key={person.id}
            className="p-4 rounded-xl border border-line bg-surface shadow-xs flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`w-10 h-10 rounded-full font-bold text-sm flex items-center justify-center shrink-0 ${person.avatarTone}`}
              >
                {person.initials}
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-ink truncate">{person.name}</h3>
                <p className="text-[11px] text-muted flex items-center gap-1 truncate mt-0.5">
                  <Mail className="w-3 h-3 text-faint shrink-0" />
                  {person.email}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                  roleBadges[person.role] || 'bg-surface-3 text-muted border-line'
                }`}
              >
                {person.role}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
