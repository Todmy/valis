# Data Model: Web Project Member Management

**Feature**: 008-project-member-mgmt

## Existing Entities (no schema changes needed)

### projects
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| org_id | UUID | FK → orgs |
| name | TEXT | 1-100 chars, unique per org |
| invite_code | TEXT | UNIQUE |
| created_at | TIMESTAMPTZ | |

### project_members
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| project_id | UUID | FK → projects |
| member_id | UUID | FK → members |
| role | TEXT | 'project_admin' or 'project_member' |
| joined_at | TIMESTAMPTZ | Used for rate limiting |
| | | UNIQUE (project_id, member_id) |

### members
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| org_id | UUID | FK → orgs |
| author_name | TEXT | Display name |
| email | TEXT | UNIQUE, links to Supabase Auth |
| auth_user_id | UUID | FK → auth.users, for RLS |
| role | TEXT | 'admin' or 'member' (org-level) |
| api_key | TEXT | tmm_... format |
| revoked_at | TIMESTAMPTZ | Soft delete |

## Relationships for Project Detail Page

```
project (1) ←→ (N) project_members (N) ←→ (1) member
                        ↓
                   role: project_admin | project_member
                   joined_at: timestamp
```

## Queries

### Get project with members
```
projects?select=id,name,invite_code,created_at
  &id=eq.{project_id}

project_members?select=id,role,joined_at,members(id,author_name,email,role)
  &project_id=eq.{project_id}
```

### Check admin permission
```
project_members?select=role
  &project_id=eq.{id}
  &member_id=eq.{auth_user_member_id}
  &role=eq.project_admin
```

## No Migration Needed

All required tables and columns already exist from migrations 001-009.
