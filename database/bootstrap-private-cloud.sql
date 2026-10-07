-- New independent Supabase project only. Run this entire file in SQL Editor.
-- One-shot, fail-closed setup: existing application objects require manual audit.
begin;
set local lock_timeout = '5s';

do $preflight$
begin
    if to_regprocedure('auth.uid()') is null or to_regclass('auth.users') is null
       or to_regrole('authenticated') is null or to_regrole('anon') is null
       or to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
        raise exception 'Supabase auth and Storage prerequisites required';
    end if;
    if to_regclass('public.work_orders') is not null then
        raise exception 'Existing work_orders: stop and audit; no data or schema will be replaced';
    end if;
    if exists (select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('restore_work_orders', 'change_order_photos',
            'verification_checklist_is_valid', 'verification_files_are_valid',
            'owner_media_path_is_valid', 'private_media_references_are_valid')) then
        raise exception 'Existing application functions: stop and audit';
    end if;
    -- Conservative: even unrelated policies may OR together and expose this bucket.
    lock table storage.objects, storage.buckets in share row exclusive mode;
    if exists (select 1 from pg_catalog.pg_policy where polrelid = 'storage.objects'::regclass) then
        raise exception 'Unexpected Storage policies: stop and audit every policy';
    end if;
    if not exists (select 1 from pg_catalog.pg_class
        where oid = 'storage.objects'::regclass and relrowsecurity) then
        raise exception 'Storage objects must already enforce RLS';
    end if;
    if exists (select 1 from storage.buckets where id = 'photos' or name = 'photos') then
        raise exception 'Existing photos bucket: stop and audit; never flip public state';
    end if;
end;
$preflight$;

create table public.work_orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id),
    order_number integer not null check (order_number > 0),
    fecha date not null,
    nombre text not null,
    telefono text not null default '',
    vehiculo text not null,
    dominio text not null,
    novedades text not null,
    garantia boolean not null default false,
    oblea boolean not null default false,
    ph boolean not null default false,
    nv boolean not null default false,
    retencion boolean not null default false,
    mangueras boolean not null default false,
    fotos text[] not null default '{}',
    verification_checklist jsonb not null default '{}',
    verification_files text[] not null default '{}',
    status text not null default 'Abierta' check (status in ('Abierta', 'Finalizada')),
    monto_cobrado numeric check (monto_cobrado >= 0),
    forma_pago text not null default '',
    notas_extra text not null default '',
    created_at timestamptz not null default now()
);
alter table public.work_orders enable row level security;
revoke all on public.work_orders from public, anon, authenticated;
grant select, insert, update, delete on public.work_orders to authenticated;
create policy owner_orders on public.work_orders for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 20971520, array['image/jpeg', 'image/png', 'application/pdf',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

-- BEGIN EMBEDDED ATOMIC OPERATIONS (exact copy; tested in lockstep)

create or replace function public.verification_checklist_is_valid(value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
    select value = '{}'::jsonb or (
        pg_catalog.jsonb_typeof(value) = 'object'
        and value ?& array['REGULADOR', 'MANGUERAS GNC', 'FILTRO DE GAS', 'CAÑO ALTA PRESION',
            'MANGUERAS AGUA', 'CUNA', 'CILINDRO', 'VALVULA CILINDRO', 'RETENCION',
            'NIPLES Y VIROLAS', 'SISTEMA VENTEO', 'CABLEADO VALVULA']
        and not exists (
            select 1 from pg_catalog.jsonb_object_keys(value) as keys(key)
            where key <> all(array['REGULADOR', 'MANGUERAS GNC', 'FILTRO DE GAS', 'CAÑO ALTA PRESION',
                'MANGUERAS AGUA', 'CUNA', 'CILINDRO', 'VALVULA CILINDRO', 'RETENCION',
                'NIPLES Y VIROLAS', 'SISTEMA VENTEO', 'CABLEADO VALVULA'])
        )
        and not exists (
            select 1 from pg_catalog.jsonb_each(value) entry(key, item)
            where pg_catalog.jsonb_typeof(item) <> 'object'
               or not (item ?& array['status', 'note'])
               or exists (
                   select 1 from pg_catalog.jsonb_object_keys(item) item_key(key)
                   where item_key.key not in ('status', 'note')
               )
               or (item -> 'status' <> 'null'::jsonb and item ->> 'status' not in ('OK', 'NO OK', 'N/A'))
               or pg_catalog.jsonb_typeof(item -> 'note') <> 'string'
        )
    );
$function$;

-- Canonical durable references contain no URL, encoded separator, or traversal.
create or replace function public.owner_media_path_is_valid(value text, owner_id uuid, verification boolean)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
    select pg_catalog.split_part(value, '/', 1) = owner_id::text
        and case when verification then
            value ~ '^[0-9a-f-]{36}/verification/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf|xls|xlsx)$'
        else
            value ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png)$'
        end;
$function$;

create or replace function public.verification_files_are_valid(value text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
    select not exists (
        select 1 from pg_catalog.unnest(value) file_path
        where file_path is null or file_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/verification/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf|xls|xlsx)$'
           or pg_catalog.octet_length(file_path) > 8192
    );
$function$;

do $constraints$
begin
    if not exists (select 1 from pg_catalog.pg_constraint where conname = 'work_orders_verification_checklist_valid' and conrelid = 'public.work_orders'::regclass) then
        alter table public.work_orders
            add constraint work_orders_verification_checklist_valid
            check (public.verification_checklist_is_valid(verification_checklist)) not valid;
    end if;
    if not exists (select 1 from pg_catalog.pg_constraint where conname = 'work_orders_verification_files_valid' and conrelid = 'public.work_orders'::regclass) then
        alter table public.work_orders
            add constraint work_orders_verification_files_valid
            check (public.verification_files_are_valid(verification_files)) not valid;
    end if;
end;
$constraints$;

create or replace function public.restore_work_orders(p_orders jsonb, p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    owner_id uuid := auth.uid();
    item jsonb;
    typed public.work_orders%rowtype;
    kept_ids uuid[] := '{}';
    columns_sql text;
    updates_sql text;
    affected integer;
    allowed constant text[] := array['id', 'user_id', 'order_number', 'fecha', 'nombre',
        'telefono', 'vehiculo', 'dominio', 'novedades', 'garantia', 'oblea', 'ph', 'nv',
        'retencion', 'mangueras', 'fotos', 'verification_checklist', 'verification_files',
        'status', 'monto_cobrado', 'forma_pago', 'notas_extra', 'created_at'];
begin
    if owner_id is null or owner_id is distinct from p_user_id then
        raise exception 'Authenticated owner mismatch' using errcode = '42501';
    end if;
    if pg_catalog.jsonb_typeof(p_orders) is distinct from 'array' then
        raise exception 'Backup must be an array';
    end if;
    if pg_catalog.jsonb_array_length(p_orders) not between 1 and 10000
       or pg_catalog.octet_length(p_orders::text) > 20971520 then
        raise exception 'Backup must contain 1..10000 orders and at most 20 MiB';
    end if;

    -- Validate every row and schema-dependent conversion before acquiring the write lock.
    for item in select value from pg_catalog.jsonb_array_elements(p_orders) loop
        if pg_catalog.jsonb_typeof(item) is distinct from 'object' then
            raise exception 'Each backup entry must be an object';
        end if;
        if not (item ?& array['id', 'user_id', 'order_number', 'fecha', 'nombre', 'telefono',
            'vehiculo', 'dominio', 'novedades', 'garantia', 'oblea', 'ph', 'nv', 'retencion',
            'mangueras', 'fotos', 'status', 'monto_cobrado', 'forma_pago', 'notas_extra']) then
            raise exception 'Missing required normalized order fields';
        end if;
        item := item || pg_catalog.jsonb_build_object(
            'verification_checklist', case when item ? 'verification_checklist' then item -> 'verification_checklist' else '{}'::jsonb end,
            'verification_files', case when item ? 'verification_files' then item -> 'verification_files' else '[]'::jsonb end
        );
        if exists (
            select 1 from pg_catalog.jsonb_object_keys(item) as keys(key)
            where not (key = any(allowed))
        ) then
            raise exception 'Unknown backup field';
        end if;
        if exists (
            select 1 from pg_catalog.unnest(array['nombre', 'vehiculo', 'dominio', 'novedades']) fields(name)
            where pg_catalog.jsonb_typeof(item -> name) is distinct from 'string'
               or pg_catalog.btrim(item ->> name) = ''
        ) then
            raise exception 'Required order text must be nonempty strings';
        end if;
        if exists (
            select 1 from pg_catalog.unnest(array['telefono', 'forma_pago', 'notas_extra']) fields(name)
            where pg_catalog.jsonb_typeof(item -> name) is distinct from 'string'
        ) then
            raise exception 'Optional order text must be normalized strings';
        end if;
        if exists (
            select 1 from pg_catalog.unnest(array['garantia', 'oblea', 'ph', 'nv', 'retencion', 'mangueras']) fields(name)
            where pg_catalog.jsonb_typeof(item -> name) is distinct from 'boolean'
        ) then
            raise exception 'Order flags must be booleans';
        end if;
        if item ->> 'status' not in ('Abierta', 'Finalizada') then
            raise exception 'Invalid order status';
        end if;
        if pg_catalog.jsonb_typeof(item -> 'fotos') is distinct from 'array' then
            raise exception 'Photos must be an array';
        end if;
        if exists (
            select 1 from pg_catalog.jsonb_array_elements(item -> 'fotos') photo
            where pg_catalog.jsonb_typeof(photo) <> 'string'
               or ((photo #>> '{}') !~ '^https://[^[:space:]]+$'
                   and not public.owner_media_path_is_valid(photo #>> '{}', owner_id, false))
               or pg_catalog.octet_length(photo #>> '{}') > 8192
        ) then
            raise exception 'Photos must contain valid HTTPS URLs';
        end if;
        if pg_catalog.jsonb_typeof(item -> 'verification_checklist') is distinct from 'object' then
            raise exception 'Verification checklist must be an object';
        end if;
        if not public.verification_checklist_is_valid(item -> 'verification_checklist') then
            raise exception 'Invalid verification checklist';
        end if;
        if pg_catalog.jsonb_typeof(item -> 'verification_files') is distinct from 'array' then
            raise exception 'Verification files must be an array';
        end if;
        if exists (
            select 1 from pg_catalog.jsonb_array_elements(item -> 'verification_files') file_path
             where pg_catalog.jsonb_typeof(file_path) <> 'string'
                or not public.owner_media_path_is_valid(file_path #>> '{}', owner_id, true)
        ) or not public.verification_files_are_valid(array(
            select file_path #>> '{}' from pg_catalog.jsonb_array_elements(item -> 'verification_files') file_path
        )) then
            raise exception 'Verification files must contain safe storage paths';
        end if;
        if item ? 'created_at' and pg_catalog.jsonb_typeof(item -> 'created_at') <> 'string' then
            raise exception 'created_at must be a timestamp string';
        end if;

        -- PostgreSQL casts remain authoritative for UUID, date, timestamp, numeric, and schema constraints.
        select * into typed from pg_catalog.jsonb_populate_record(null::public.work_orders, item);
        if typed.id is null or typed.user_id is distinct from owner_id or typed.fecha is null
           or typed.order_number is null or typed.order_number < 1 or typed.status is null
           or (typed.monto_cobrado is not null and typed.monto_cobrado < 0) then
            raise exception 'Invalid order identity, owner, date, number, status, or amount';
        end if;
        if typed.id = any(kept_ids) then
            raise exception 'Duplicate order id';
        end if;
        kept_ids := pg_catalog.array_append(kept_ids, typed.id);
    end loop;

    -- One transaction covers all upserts and the final owner-scoped deletion.
    lock table public.work_orders in share row exclusive mode;
    for item in select value from pg_catalog.jsonb_array_elements(p_orders) loop
        item := item || pg_catalog.jsonb_build_object(
            'verification_checklist', case when item ? 'verification_checklist' then item -> 'verification_checklist' else '{}'::jsonb end,
            'verification_files', case when item ? 'verification_files' then item -> 'verification_files' else '[]'::jsonb end
        );
        select pg_catalog.string_agg(pg_catalog.format('%I', key), ', ' order by key),
               pg_catalog.string_agg(pg_catalog.format('%1$I = excluded.%1$I', key), ', ' order by key)
                   filter (where key <> 'id')
        into columns_sql, updates_sql
        from pg_catalog.jsonb_object_keys(item) as keys(key);
        execute pg_catalog.format(
            'insert into public.work_orders (%1$s)
             select %1$s from pg_catalog.jsonb_populate_record(null::public.work_orders, $1)
             on conflict (id) do update set %2$s where work_orders.user_id = $2',
            columns_sql, updates_sql
        ) using item, owner_id;
        get diagnostics affected = row_count;
        if affected <> 1 then
            raise exception 'Order is not owned by the authenticated user' using errcode = '42501';
        end if;
    end loop;
    delete from public.work_orders
    where user_id = owner_id and not (id = any(kept_ids));
    return pg_catalog.cardinality(kept_ids);
end;
$function$;

create or replace function public.change_order_photos(
    p_order_id uuid, p_add jsonb, p_remove jsonb, p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    owner_id uuid := auth.uid();
    existing public.work_orders%rowtype;
    photos jsonb;
    merged jsonb;
begin
    if owner_id is null or owner_id is distinct from p_user_id then
        raise exception 'Authenticated owner mismatch' using errcode = '42501';
    end if;
    if pg_catalog.jsonb_typeof(p_add) is distinct from 'array'
       or pg_catalog.jsonb_typeof(p_remove) is distinct from 'array' then
        raise exception 'Photo deltas must be arrays';
    end if;
    if exists (
        select 1 from pg_catalog.jsonb_array_elements(p_add || p_remove) photo
        where pg_catalog.jsonb_typeof(photo) <> 'string'
           or ((photo #>> '{}') !~ '^https://[^[:space:]]+$'
               and not public.owner_media_path_is_valid(photo #>> '{}', owner_id, false))
           or pg_catalog.octet_length(photo #>> '{}') > 8192
    ) then
        raise exception 'Photo deltas must contain valid HTTPS URLs';
    end if;

    -- The private bootstrap marks its table with this additional constraint.
    -- Validate removals as well as additions; a no-op must not bypass the contract.
    if exists (select 1 from pg_catalog.pg_constraint
        where conrelid = 'public.work_orders'::regclass and conname = 'work_orders_private_media_valid')
       and exists (select 1 from pg_catalog.jsonb_array_elements_text(p_add || p_remove) photo
           where not public.owner_media_path_is_valid(photo, owner_id, false)) then
        raise exception 'Private photo deltas require owner storage paths';
    end if;

    -- Serialize every delta against the latest committed photo list.
    select * into existing
    from public.work_orders
    where id = p_order_id and user_id = owner_id
    for update;
    if not found then
        raise exception 'Order not found or not owned' using errcode = '42501';
    end if;

    photos := coalesce(
        nullif(pg_catalog.to_jsonb(existing) -> 'fotos', 'null'::jsonb),
        '[]'::jsonb
    );
    if pg_catalog.jsonb_typeof(photos) <> 'array' then
        raise exception 'Existing photos are not an array';
    end if;
    if pg_catalog.jsonb_array_length(p_add) = 0
       and pg_catalog.jsonb_array_length(p_remove) = 0 then
        return photos;
    end if;
    if pg_catalog.jsonb_array_length(p_add) > 0 and existing.status = 'Finalizada' then
        raise exception 'Cannot add photos to a completed order';
    end if;

    -- Removal wins when a URL appears in both deltas. Grouping makes retries idempotent.
    select coalesce(pg_catalog.jsonb_agg(value order by position), '[]'::jsonb)
    into merged
    from (
        select value, pg_catalog.min(ordinality) as position
        from pg_catalog.jsonb_array_elements_text(photos || p_add) with ordinality
        where value not in (select pg_catalog.jsonb_array_elements_text(p_remove))
        group by value
    ) distinct_photos;

    update public.work_orders
    set fotos = (pg_catalog.jsonb_populate_record(
        null::public.work_orders,
        pg_catalog.jsonb_build_object('fotos', merged)
    )).fotos
    where id = p_order_id and user_id = owner_id;
    if not found then
        raise exception 'Photo update was rejected';
    end if;
    return merged;
end;
$function$;

revoke all on function public.restore_work_orders(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.owner_media_path_is_valid(text, uuid, boolean) from public, anon;
revoke all on function public.verification_checklist_is_valid(jsonb) from public, anon;
revoke all on function public.verification_files_are_valid(text[]) from public, anon;
grant execute on function public.owner_media_path_is_valid(text, uuid, boolean),
    public.verification_checklist_is_valid(jsonb), public.verification_files_are_valid(text[]) to authenticated;
revoke all on function public.change_order_photos(uuid, jsonb, jsonb, uuid)
    from public, anon, authenticated;
grant execute on function public.restore_work_orders(jsonb, uuid) to authenticated;
grant execute on function public.change_order_photos(uuid, jsonb, jsonb, uuid) to authenticated;
-- END EMBEDDED ATOMIC OPERATIONS

create function public.private_media_references_are_valid(value text[], owner_id uuid, verification boolean)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
    select not exists (select 1 from pg_catalog.unnest(value) path
        where public.owner_media_path_is_valid(path, owner_id, verification) is distinct from true);
$function$;
revoke all on function public.private_media_references_are_valid(text[], uuid, boolean) from public, anon;
grant execute on function public.private_media_references_are_valid(text[], uuid, boolean) to authenticated;

-- Every direct write and restore is private-only, including nullable array elements.
alter table public.work_orders add constraint work_orders_private_media_valid check (
    public.private_media_references_are_valid(fotos, user_id, false)
    and public.private_media_references_are_valid(verification_files, user_id, true)
);

create policy owner_photo_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'photos' and (
        public.owner_media_path_is_valid(name, (select auth.uid()), false)
        or public.owner_media_path_is_valid(name, (select auth.uid()), true)));
create policy owner_photo_select on storage.objects for select to authenticated
    using (bucket_id = 'photos' and (
        public.owner_media_path_is_valid(name, (select auth.uid()), false)
        or public.owner_media_path_is_valid(name, (select auth.uid()), true)));
create policy owner_photo_delete on storage.objects for delete to authenticated
    using (bucket_id = 'photos' and (
        public.owner_media_path_is_valid(name, (select auth.uid()), false)
        or public.owner_media_path_is_valid(name, (select auth.uid()), true)));
-- No UPDATE/upsert policy; clients create new random object names.
notify pgrst, 'reload schema';
commit;
