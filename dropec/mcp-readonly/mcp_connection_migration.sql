-- Supabase B only. Keeps MCP tool calls DISABLED until separately enabled.
alter table dropec_private.dropi_mcp_oauth_settings
  add column if not exists readonly_enabled boolean not null default false;

do $$
begin
  if not exists (select 1 from vault.secrets where name='dropec_mcp_api_internal_key') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),
                                'dropec_mcp_api_internal_key',
                                'DropEC MCP read-only transport internal key: B only');
  end if;
end $$;
