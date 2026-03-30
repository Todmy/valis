/**
 * Project detail page — member management, invite form, role badges.
 *
 * Features:
 * - Project header with name + member count
 * - Member table: Name, Email, Role (badge), Joined, Actions
 * - Invite form (admin only): email input → POST /api/invite-member
 * - Remove button (admin only, not for self): POST /api/remove-member
 * - Dark mode: bg-gray-950/900, text-gray-100, border-gray-800
 */

'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { useDashboardAuth } from '@/app/app-shell';

interface MemberRow {
  id: string;
  role: string;
  joined_at: string;
  member_id: string;
  members: {
    id: string;
    author_name: string;
    email: string | null;
  } | null;
}

interface ProjectData {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

function ProjectDetailContent() {
  const params = useParams();
  const projectId = params.id as string;
  const { supabase, userId } = useDashboardAuth();

  const [project, setProject] = useState<ProjectData | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Remove state
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!supabase || !projectId) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch project details
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('id, name, invite_code, created_at')
        .eq('id', projectId)
        .single();

      if (projectError || !projectData) {
        setError('Project not found');
        setLoading(false);
        return;
      }
      setProject(projectData as ProjectData);

      // Fetch members with joined member info
      const { data: membersData, error: membersError } = await supabase
        .from('project_members')
        .select('id, role, joined_at, member_id, members(id, author_name, email)')
        .eq('project_id', projectId);

      if (membersError) {
        setError('Failed to load members');
        setLoading(false);
        return;
      }

      const rows = (membersData ?? []) as unknown as MemberRow[];
      setMembers(rows);

      // Resolve current user's member_id via auth_user_id
      const { data: currentMember } = await supabase
        .from('members')
        .select('id')
        .eq('auth_user_id', userId)
        .is('revoked_at', null)
        .single();

      const myMemberId = currentMember?.id ?? null;
      setCurrentMemberId(myMemberId);

      // Check if current user is a project_admin
      if (myMemberId) {
        const myPM = rows.find((r) => r.member_id === myMemberId);
        setIsAdmin(myPM?.role === 'project_admin');
      } else {
        setIsAdmin(false);
      }
    } catch (err) {
      setError((err as Error).message);
    }

    setLoading(false);
  }, [supabase, projectId, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function getAccessToken(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    setInviteSuccess(null);
    setInviteError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setInviteError('Not authenticated');
        setInviting(false);
        return;
      }

      const res = await fetch('/api/invite-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ project_id: projectId, email: inviteEmail.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data.message || data.error || 'Invite failed';
        setInviteError(message);
      } else {
        setInviteSuccess(`Invited ${inviteEmail.trim()} to the project`);
        setInviteEmail('');
        fetchData();
      }
    } catch (err) {
      setInviteError((err as Error).message);
    }

    setInviting(false);
  }

  async function handleRemove(memberId: string, memberName: string) {
    const confirmed = window.confirm(`Remove ${memberName} from this project?`);
    if (!confirmed) return;

    setRemovingId(memberId);

    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Not authenticated');
        setRemovingId(null);
        return;
      }

      const res = await fetch('/api/remove-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ project_id: projectId, member_id: memberId }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data.message || data.error || 'Remove failed';
        alert(message);
      } else {
        fetchData();
      }
    } catch (err) {
      alert((err as Error).message);
    }

    setRemovingId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">Loading project...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-400">{error ?? 'Project not found'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">{project.name}</h1>
          <p className="text-sm text-gray-400 mt-1">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Invite form (admin only) */}
      {isAdmin && (
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-gray-100 mb-3">Invite Member</h2>
          <form onSubmit={handleInvite} className="flex gap-3 items-start">
            <div className="flex-1">
              <input
                type="email"
                required
                placeholder="team@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-700 rounded-md text-sm bg-gray-800 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {inviting ? 'Inviting...' : 'Invite'}
            </button>
          </form>
          {inviteSuccess && (
            <p className="text-sm text-green-400 mt-2">{inviteSuccess}</p>
          )}
          {inviteError && (
            <p className="text-sm text-red-400 mt-2">{inviteError}</p>
          )}
        </section>
      )}

      {/* Member table */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Role</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Joined</th>
              {isAdmin && (
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="px-4 py-6 text-center text-gray-500">
                  No members found.
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const name = m.members?.author_name ?? 'Unknown';
                const email = m.members?.email ?? '';
                const isSelf = m.member_id === currentMemberId;
                const isRemoving = removingId === m.member_id;

                return (
                  <tr key={m.id} className="border-b border-gray-800 last:border-b-0">
                    <td className="px-4 py-3 text-gray-100">
                      {name}
                      {isSelf && <span className="text-xs text-gray-500 ml-2">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={m.role} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(m.joined_at).toLocaleDateString()}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        {!isSelf && (
                          <button
                            onClick={() => handleRemove(m.member_id, name)}
                            disabled={isRemoving}
                            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {isRemoving ? 'Removing...' : 'Remove'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === 'project_admin';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
        isAdmin
          ? 'bg-blue-900/50 text-blue-300 border border-blue-700'
          : 'bg-gray-800 text-gray-300 border border-gray-700'
      }`}
    >
      {isAdmin ? 'Admin' : 'Member'}
    </span>
  );
}

export default function ProjectDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-400">Loading project...</p>
        </div>
      }
    >
      <ProjectDetailContent />
    </Suspense>
  );
}
