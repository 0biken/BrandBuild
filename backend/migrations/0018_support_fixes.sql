-- Support access is tied to live staff eligibility, versioned content and durable notice delivery.
ALTER TABLE admin.support_sessions ADD COLUMN customer_notification_queued_at timestamptz;
CREATE INDEX support_sessions_requester_live_idx ON admin.support_sessions(requested_by) WHERE status IN ('pending_approval','approved','active');
CREATE INDEX support_sessions_approver_live_idx ON admin.support_sessions(approved_by) WHERE status IN ('pending_approval','approved','active');

CREATE TABLE admin.support_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_session_id uuid NOT NULL UNIQUE REFERENCES admin.support_sessions(id),
  recipients text[] NOT NULL CHECK (cardinality(recipients) > 0),
  subject text NOT NULL,
  body text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_notification_pending_idx ON admin.support_notification_outbox(available_at) WHERE delivered_at IS NULL;
REVOKE ALL ON admin.support_notification_outbox FROM PUBLIC, brandbuild_app;
GRANT SELECT, INSERT, UPDATE ON admin.support_notification_outbox TO brandbuild_admin;

CREATE FUNCTION admin.revoke_support_access() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, admin AS $$
DECLARE v_staff uuid;
BEGIN
  IF TG_TABLE_NAME = 'staff_users' THEN
    IF NEW.roles IS NOT DISTINCT FROM OLD.roles AND NEW.is_active = OLD.is_active THEN RETURN NEW; END IF;
    v_staff := NEW.id;
  ELSE
    IF NEW.revoked_at IS NULL OR OLD.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
    v_staff := NEW.staff_user_id;
  END IF;
  UPDATE admin.support_sessions SET status='revoked', ended_at=clock_timestamp()
  WHERE (requested_by=v_staff OR approved_by=v_staff) AND status IN ('pending_approval','approved','active');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION admin.revoke_support_access() FROM PUBLIC, brandbuild_app;
CREATE TRIGGER staff_support_revoke AFTER UPDATE OF roles,is_active ON admin.staff_users FOR EACH ROW EXECUTE FUNCTION admin.revoke_support_access();
CREATE TRIGGER logout_support_revoke AFTER UPDATE OF revoked_at ON admin.staff_sessions FOR EACH ROW EXECUTE FUNCTION admin.revoke_support_access();

CREATE FUNCTION admin.support_session_guard(p_id uuid,p_staff uuid,p_write boolean,p_activation boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin, pg_temp AS $$
DECLARE s admin.support_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM admin.support_sessions WHERE id=p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Lock identities before the session, matching role updates and logout revocation.
  PERFORM id FROM admin.staff_users WHERE id IN (s.requested_by,s.approved_by,p_staff) ORDER BY id FOR SHARE;
  SELECT * INTO s FROM admin.support_sessions WHERE id=p_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM admin.staff_users WHERE id=p_staff AND is_active AND roles && ARRAY['support','operations','staff_admin'])
     OR NOT EXISTS(SELECT 1 FROM admin.staff_users WHERE id=s.requested_by AND is_active AND roles && ARRAY['support','operations','staff_admin'])
     OR (s.requested_by<>p_staff AND (NOT p_activation OR NOT EXISTS(SELECT 1 FROM admin.staff_users WHERE id=p_staff AND 'staff_admin'=ANY(roles))))
     OR (p_activation AND s.status<>'approved')
     OR (NOT p_activation AND (s.status<>'active' OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp()))
     OR (p_write AND s.mode<>'read_write')
     OR (s.mode='read_write' AND (s.approved_by IS NULL OR s.approved_by=s.requested_by OR NOT EXISTS(SELECT 1 FROM admin.staff_users WHERE id=s.approved_by AND is_active AND roles && ARRAY['operations','staff_admin'])))
  THEN RETURN NULL; END IF;
  RETURN to_jsonb(s);
END $$;
ALTER FUNCTION admin.support_session_guard(uuid,uuid,boolean,boolean) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.support_session_guard(uuid,uuid,boolean,boolean) FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.support_session_guard(uuid,uuid,boolean,boolean) TO brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.support_workspace_view(p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin, pg_temp AS $$
DECLARE ws jsonb; drafts jsonb; brand jsonb; facts jsonb;
BEGIN
 SELECT jsonb_build_object('id',id,'name',name,'plan',plan,'timezone',timezone) INTO ws FROM tenants WHERE id=p_tenant_id;
 SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]') INTO drafts FROM (
  SELECT p.id,p.title,coalesce(v.content->>'caption','') AS body,p.platforms,p.state::text AS state,p.scheduled_for AS "scheduledFor",p.updated_at AS "updatedAt"
  FROM posts p JOIN post_versions v ON v.tenant_id=p.tenant_id AND v.post_id=p.id AND v.version=p.current_version
  WHERE p.tenant_id=p_tenant_id AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 40
 ) d;
 SELECT to_jsonb(b) INTO brand FROM (SELECT name,voice,audience,guidelines FROM brand_profiles WHERE tenant_id=p_tenant_id ORDER BY created_at LIMIT 1) b;
 SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]') INTO facts FROM (SELECT id,kind,label,value,(status='verified') AS verified FROM brand_facts WHERE tenant_id=p_tenant_id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30) f;
 RETURN jsonb_build_object('workspace',ws,'drafts',drafts,'brand',brand,'facts',facts);
END $$;

DROP FUNCTION admin.support_update_draft(uuid,uuid,text,text,uuid,uuid);
CREATE FUNCTION admin.support_update_draft(p_tenant_id uuid,p_post_id uuid,p_title text,p_content jsonb,p_hash text,p_staff_id uuid,p_session_id uuid,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin, pg_temp AS $$
DECLARE p posts%ROWTYPE; old_content jsonb; s jsonb; next_version integer;
BEGIN
 s := admin.support_session_guard(p_session_id,p_staff_id,true,false);
 IF s IS NULL OR (s->>'tenant_id')::uuid<>p_tenant_id THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
 SELECT * INTO p FROM posts WHERE tenant_id=p_tenant_id AND id=p_post_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF p.state NOT IN ('draft','changes_requested') OR p.current_version<>p_expected_version THEN RETURN jsonb_build_object('ok',false,'reason','not_draft'); END IF;
 SELECT content INTO old_content FROM post_versions WHERE tenant_id=p_tenant_id AND post_id=p_post_id AND version=p.current_version;
 IF old_content IS NULL OR p_content IS NULL OR p_hash IS NULL OR p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 200 OR (old_content-'caption') IS DISTINCT FROM (p_content-'caption') OR jsonb_typeof(p_content->'caption') IS DISTINCT FROM 'string' OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid_content'); END IF;
 SELECT coalesce(max(version),0)+1 INTO next_version FROM post_versions WHERE tenant_id=p_tenant_id AND post_id=p_post_id;
 INSERT INTO post_versions(tenant_id,post_id,version,content,content_hash,created_by,staff_actor_id,support_session_id) VALUES(p_tenant_id,p_post_id,next_version,p_content,p_hash,NULL,p_staff_id,p_session_id);
 UPDATE posts SET title=p_title,current_version=next_version,updated_at=clock_timestamp() WHERE id=p_post_id;
 INSERT INTO post_activity(tenant_id,post_id,actor_id,text,staff_actor_id,support_session_id) VALUES(p_tenant_id,p_post_id,NULL,'Draft updated by BrandBuild Support',p_staff_id,p_session_id);
 INSERT INTO audit_log(tenant_id,actor_id,action,resource_type,resource_id,details,staff_actor_id,support_session_id) VALUES(p_tenant_id,NULL,'support.draft_updated','post',p_post_id,jsonb_build_object('attribution','BrandBuild Support'),p_staff_id,p_session_id);
 RETURN jsonb_build_object('ok',true,'id',p_post_id,'version',next_version);
END $$;
ALTER FUNCTION admin.support_update_draft(uuid,uuid,text,jsonb,text,uuid,uuid,integer) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.support_update_draft(uuid,uuid,text,jsonb,text,uuid,uuid,integer) FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.support_update_draft(uuid,uuid,text,jsonb,text,uuid,uuid,integer) TO brandbuild_admin;

CREATE FUNCTION admin.queue_support_notification(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin, pg_temp AS $$
DECLARE s admin.support_sessions%ROWTYPE; recipients text[];
BEGIN
 SELECT * INTO s FROM admin.support_sessions WHERE id=p_id;
 SELECT array_agg(DISTINCT u.email) INTO recipients FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=s.tenant_id AND m.role='owner';
 IF recipients IS NULL THEN RETURN false; END IF;
 INSERT INTO admin.support_notification_outbox(support_session_id,recipients,subject,body)
 VALUES(p_id,recipients,'BrandBuild support access activated',format('BrandBuild Support has activated a %s support session for your workspace. Ticket: %s. Reason: %s. Access expires at %s.',s.mode,s.ticket_ref,s.reason,s.expires_at));
 RETURN true;
END $$;
ALTER FUNCTION admin.queue_support_notification(uuid) OWNER TO brandbuild_admin_definer;
GRANT SELECT, INSERT ON admin.support_notification_outbox TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.queue_support_notification(uuid) FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.queue_support_notification(uuid) TO brandbuild_admin;

CREATE FUNCTION admin.support_draft_for_edit(p_tenant uuid,p_post uuid,p_staff uuid,p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin, pg_temp AS $$
DECLARE s jsonb; result jsonb;
BEGIN
 s:=admin.support_session_guard(p_session,p_staff,true,false);
 IF s IS NULL OR (s->>'tenant_id')::uuid<>p_tenant THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('version',p.current_version,'content',v.content) INTO result
 FROM posts p JOIN post_versions v ON v.tenant_id=p.tenant_id AND v.post_id=p.id AND v.version=p.current_version
 WHERE p.tenant_id=p_tenant AND p.id=p_post AND p.deleted_at IS NULL FOR UPDATE OF p;
 RETURN result;
END $$;
ALTER FUNCTION admin.support_draft_for_edit(uuid,uuid,uuid,uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.support_draft_for_edit(uuid,uuid,uuid,uuid) FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.support_draft_for_edit(uuid,uuid,uuid,uuid) TO brandbuild_admin;

-- Row locks require UPDATE privilege on the locked tables.
GRANT UPDATE ON admin.staff_users, admin.support_sessions TO brandbuild_admin_definer;

CREATE OR REPLACE FUNCTION admin.list_support_sessions(p_tenant_id uuid DEFAULT NULL,p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin, pg_temp AS $$
DECLARE items jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]') INTO items FROM (
  SELECT ss.id,ss.tenant_id AS "tenantId",t.name AS "workspaceName",ss.mode,ss.ticket_ref AS "ticketRef",ss.reason,
   ss.duration_minutes AS "durationMinutes",ss.status,ss.requested_by AS "requestedBy",req.display_name AS "requestedByName",req.email AS "requestedByEmail",
   ss.approved_by AS "approvedBy",app.display_name AS "approvedByName",ss.customer_notified_at AS "customerNotifiedAt",
   ss.customer_notification_queued_at AS "customerNotificationQueuedAt",ss.activated_at AS "activatedAt",ss.expires_at AS "expiresAt",ss.ended_at AS "endedAt",ss.created_at AS "createdAt"
  FROM admin.support_sessions ss JOIN tenants t ON t.id=ss.tenant_id JOIN admin.staff_users req ON req.id=ss.requested_by LEFT JOIN admin.staff_users app ON app.id=ss.approved_by
  WHERE (p_tenant_id IS NULL OR ss.tenant_id=p_tenant_id) AND (p_status IS NULL OR ss.status=p_status) ORDER BY ss.created_at DESC LIMIT 100
 ) s;
 RETURN items;
END $$;
