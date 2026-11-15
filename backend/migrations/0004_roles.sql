-- Workspace roles: owner, editor, reviewer. "member" was the old default.
UPDATE tenant_memberships SET role = 'editor' WHERE role NOT IN ('owner', 'editor', 'reviewer');
ALTER TABLE tenant_memberships ALTER COLUMN role SET DEFAULT 'editor';
ALTER TABLE tenant_memberships
  ADD CONSTRAINT tenant_memberships_role_check CHECK (role IN ('owner', 'editor', 'reviewer'));
