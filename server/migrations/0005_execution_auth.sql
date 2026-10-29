ALTER TABLE provider_logins ADD COLUMN reconnect boolean NOT NULL DEFAULT false;
ALTER TABLE provider_connections ADD COLUMN reauth_required boolean NOT NULL DEFAULT false;
