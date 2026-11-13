-- Local development only: the role the API connects as. Migration 0005 grants its
-- privileges and would create it without a login if this script hadn't run.
CREATE ROLE brandbuild_app LOGIN PASSWORD 'brandbuild_app';
