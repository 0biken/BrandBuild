-- Local development only: the roles the API connects as. Migrations 0005 and 0010
-- grant their privileges and would create them without a login if this script hadn't run.
CREATE ROLE brandbuild_app LOGIN PASSWORD 'brandbuild_app';
CREATE ROLE brandbuild_admin LOGIN PASSWORD 'brandbuild_admin';
