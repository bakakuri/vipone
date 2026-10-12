-- Tests exercise the whole engine (automatic chain deposits on TRON, several
-- assets, identity checks, address cooldowns), so the test template restores
-- the reference configuration that the manual-operations migration narrows
-- down for the production site.
update app.assets set is_active = true;
update app.system_settings set value = 'true'::jsonb where key = 'deposits.automatic';
update app.asset_networks set deposit_enabled = true, withdrawal_enabled = true;
update app.system_settings set value = '["deposit_address", "withdrawal", "investment"]'::jsonb where key = 'compliance.kyc_required_for';
update app.system_settings set value = '24'::jsonb where key = 'withdrawal.new_address_cooldown_hours';
update app.deposit_address_pool set status = 'available' where status = 'retired';
