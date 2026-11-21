-- Phase 4: drafts, posts, media, notifications.
-- Drafts and posts share `posts`: a draft is a row in 'draft' or 'changes_requested'.
-- The words (caption, hashtags, aspect ratio, media ids) live in post_versions.content,
-- which stays immutable: every edit adds a version.

ALTER TABLE posts
  ADD COLUMN title text NOT NULL DEFAULT '',
  ADD COLUMN platforms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN draft_state text NOT NULL DEFAULT 'idea'
    CHECK (draft_state IN ('ready', 'needs_photo', 'idea')),
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN review_requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN review_requested_at timestamptz,
  ADD CONSTRAINT posts_platforms_known CHECK (platforms <@ ARRAY['ig', 'li', 'tt', 'fb']);
CREATE INDEX posts_tenant_created_idx ON posts(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- What happened to a post, newest first on the post page.
CREATE TABLE post_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  text text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, post_id) REFERENCES posts(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX post_activity_post_idx ON post_activity(tenant_id, post_id, at DESC);

-- Uploaded photos and videos. The file itself is in object storage under storage_key.
-- Deleting only hides the row, so posts that already use the file keep working.
CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  mime text NOT NULL,
  size bigint NOT NULL CHECK (size > 0),
  duration real,
  storage_key text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX media_assets_tenant_idx ON media_assets(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- In-app notifications, one row per recipient.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('approval', 'failed', 'reconnect', 'published', 'insights')),
  title text NOT NULL,
  body text NOT NULL,
  href text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(tenant_id, user_id, created_at DESC);

CREATE TABLE notification_prefs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_reminders boolean NOT NULL DEFAULT true,
  scheduled_alerts boolean NOT NULL DEFAULT true,
  weekly_insights boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Same isolation as every other tenant table (see 0005_rls.sql).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['post_activity', 'media_assets', 'notifications', 'notification_prefs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
