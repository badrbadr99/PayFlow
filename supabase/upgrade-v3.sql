-- PayFlow v3 incremental upgrade
-- Run this file ONCE after the original setup.sql has already succeeded.

begin;

alter table public.users add column if not exists preferred_language varchar(2) not null default 'ar';
alter table public.users add column if not exists theme_preference varchar(10) not null default 'dark';
alter table public.withdraw_requests add column if not exists funding_currency varchar(10) default 'USDT';
alter table public.withdraw_requests add column if not exists reserved_yer numeric(20,2) default 0;

update public.users set preferred_language='ar' where preferred_language not in ('ar','en') or preferred_language is null;
update public.users set theme_preference='dark' where theme_preference not in ('dark','light') or theme_preference is null;
update public.withdraw_requests set funding_currency='USDT' where funding_currency is null;

create or replace function public.update_my_profile(p_full_name text,p_phone_number text)
returns void language plpgsql security definer set search_path=public as $$
declare v_user_id bigint:=public.current_profile_id();
begin
  if v_user_id is null then raise exception 'account_inactive'; end if;
  if length(trim(coalesce(p_full_name,'')))<3 then raise exception 'invalid_full_name'; end if;
  if trim(coalesce(p_phone_number,'')) !~ '^\+?[0-9]{8,15}$' then raise exception 'invalid_phone_number'; end if;
  update public.users set full_name=trim(p_full_name),phone_number=trim(p_phone_number),updated_at=now() where user_id=v_user_id;
end $$;

create or replace function public.update_my_preferences(p_language text,p_theme text)
returns void language plpgsql security definer set search_path=public as $$
declare v_user_id bigint:=public.current_profile_id();
begin
  if v_user_id is null then raise exception 'account_inactive'; end if;
  if lower(p_language) not in ('ar','en') then raise exception 'invalid_language'; end if;
  if lower(p_theme) not in ('dark','light') then raise exception 'invalid_theme'; end if;
  update public.users set preferred_language=lower(p_language),theme_preference=lower(p_theme),updated_at=now() where user_id=v_user_id;
end $$;

create or replace function public.exchange_wallet_balance(p_from_currency text,p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user public.users%rowtype;
  v_rate public.exchange_rates%rowtype;
  v_from text:=upper(trim(p_from_currency));
  v_received numeric(20,8);
  v_reference text:=public.make_reference('EXC');
begin
  select * into v_user from public.users where user_id=public.current_profile_id() for update;
  if not found then raise exception 'account_inactive'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'invalid_amount'; end if;
  if v_from not in ('YER','USDT') then raise exception 'invalid_currency'; end if;
  select * into v_rate from public.exchange_rates order by rate_id limit 1;
  if v_rate.buy_rate<=0 or v_rate.sell_rate<=0 then raise exception 'rate_unavailable'; end if;

  if v_from='YER' then
    if p_amount<1 then raise exception 'minimum_exchange_1_yer'; end if;
    if coalesce(v_user.balance_yer,0)<p_amount then raise exception 'insufficient_yer_balance'; end if;
    v_received:=round(p_amount/v_rate.sell_rate,8);
    update public.users set balance_yer=balance_yer-p_amount,balance_usdt=balance_usdt+v_received,balance=balance_usdt+v_received where user_id=v_user.user_id;
    insert into public.transactions(reference,user_id,type,status,currency,amount_usdt,amount_yer,balance_after,description,metadata)
    values(v_reference,v_user.user_id,'EXCHANGE_YER_TO_USDT','COMPLETED','YER',v_received,p_amount,v_user.balance_yer-p_amount,'مصارفة رصيد YER إلى USDT',jsonb_build_object('rate',v_rate.sell_rate,'received_currency','USDT','received_amount',v_received));
  else
    if p_amount<0.01 then raise exception 'minimum_exchange_001_usdt'; end if;
    if coalesce(v_user.balance_usdt,0)<p_amount then raise exception 'insufficient_usdt_balance'; end if;
    v_received:=round(p_amount*v_rate.buy_rate,2);
    update public.users set balance_usdt=balance_usdt-p_amount,balance=balance_usdt-p_amount,balance_yer=balance_yer+v_received where user_id=v_user.user_id;
    insert into public.transactions(reference,user_id,type,status,currency,amount_usdt,amount_yer,balance_after,description,metadata)
    values(v_reference,v_user.user_id,'EXCHANGE_USDT_TO_YER','COMPLETED','USDT',p_amount,v_received,v_user.balance_usdt-p_amount,'مصارفة رصيد USDT إلى YER',jsonb_build_object('rate',v_rate.buy_rate,'received_currency','YER','received_amount',v_received));
  end if;

  insert into public.notifications(user_id,audience,title,message,icon,reference)
  values(v_user.user_id,'USER','تمت المصارفة بنجاح',case when v_from='YER' then 'تم تحويل '||round(p_amount,2)||' YER إلى '||round(v_received,4)||' USDT.' else 'تم تحويل '||round(p_amount,4)||' USDT إلى '||round(v_received,2)||' YER.' end,'fa-right-left',v_reference);

  return jsonb_build_object('reference',v_reference,'from_currency',v_from,'from_amount',p_amount,'received_amount',v_received,'balance_usdt',case when v_from='YER' then v_user.balance_usdt+v_received else v_user.balance_usdt-p_amount end,'balance_yer',case when v_from='YER' then v_user.balance_yer-p_amount else v_user.balance_yer+v_received end);
end $$;

-- Deposits now credit the YER wallet after approval. USDT is obtained later through wallet exchange.
create or replace function public.create_deposit_request(
  p_amount_yer numeric,p_payment_method_id bigint,p_proof_path text,p_sender_name text,p_sender_phone text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user_id bigint:=public.current_profile_id();
  v_rate public.exchange_rates%rowtype;
  v_method public.payment_methods%rowtype;
  v_reference text:=public.make_reference('DEP');
  v_equivalent numeric(20,8);
  v_id bigint;
begin
  if v_user_id is null then raise exception 'account_inactive'; end if;
  if p_amount_yer is null or p_amount_yer<1000 then raise exception 'minimum_deposit_1000_yer'; end if;
  if nullif(trim(p_proof_path),'') is null then raise exception 'proof_required'; end if;
  select * into v_rate from public.exchange_rates order by rate_id limit 1;
  if v_rate.sell_rate is null or v_rate.sell_rate<=0 then raise exception 'rate_unavailable'; end if;
  select * into v_method from public.payment_methods where method_id=p_payment_method_id and is_active=true and category in ('DEPOSIT','BOTH');
  if not found then raise exception 'payment_method_unavailable'; end if;
  v_equivalent:=round(p_amount_yer/v_rate.sell_rate,8);
  insert into public.deposit_requests(reference,user_id,payment_method_id,payment_method,deposit_method,amount_yer,gross_usdt,fee_usdt,net_usdt,proof_path,proof_ref,sender_name,sender_phone,status)
  values(v_reference,v_user_id,v_method.method_id,v_method.name,v_method.name,p_amount_yer,v_equivalent,0,v_equivalent,p_proof_path,p_proof_path,p_sender_name,p_sender_phone,'PENDING') returning deposit_id into v_id;
  insert into public.transactions(reference,user_id,request_id,type,status,currency,amount_usdt,amount_yer,description,metadata)
  values(v_reference,v_user_id,v_id,'DEPOSIT','PENDING','YER',v_equivalent,p_amount_yer,'إيداع رصيد بالريال اليمني عبر '||v_method.name,jsonb_build_object('preview_sell_rate',v_rate.sell_rate));
  insert into public.notifications(user_id,audience,title,message,icon,reference) values(v_user_id,'USER','تم استلام طلب الإيداع','طلبك '||v_reference||' بانتظار مراجعة الإدارة.','fa-arrow-down',v_reference);
  insert into public.notifications(user_id,audience,title,message,icon,reference) values(null,'ADMIN','طلب إيداع جديد','طلب '||v_reference||' بقيمة '||round(p_amount_yer,0)||' YER يحتاج المراجعة.','fa-file-circle-plus',v_reference);
  return jsonb_build_object('deposit_id',v_id,'reference',v_reference,'amount_yer',p_amount_yer,'status','PENDING');
end $$;

create or replace function public.admin_review_deposit(p_deposit_id bigint,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_admin bigint:=public.current_profile_id();v_row public.deposit_requests%rowtype;v_new_balance numeric(20,2);v_decision text:=upper(p_decision);
begin
  if not public.is_admin() then raise exception 'not_authorized'; end if;
  if v_decision not in ('APPROVED','REJECTED') then raise exception 'invalid_decision'; end if;
  select * into v_row from public.deposit_requests where deposit_id=p_deposit_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if upper(v_row.status)<>'PENDING' then raise exception 'request_already_reviewed'; end if;
  if v_decision='APPROVED' then update public.users set balance_yer=coalesce(balance_yer,0)+v_row.amount_yer where user_id=v_row.user_id returning balance_yer into v_new_balance; end if;
  update public.deposit_requests set status=v_decision,admin_note=p_note,reviewed_by=v_admin,processed_at=now() where deposit_id=p_deposit_id;
  update public.transactions set status=case when v_decision='APPROVED' then 'COMPLETED' else 'REJECTED' end,currency='YER',amount_yer=v_row.amount_yer,balance_after=case when v_decision='APPROVED' then v_new_balance else balance_after end,updated_at=now() where request_id=p_deposit_id and type='DEPOSIT';
  insert into public.notifications(user_id,audience,title,message,icon,reference) values(v_row.user_id,'USER',case when v_decision='APPROVED' then 'تم قبول الإيداع' else 'تم رفض الإيداع' end,case when v_decision='APPROVED' then 'أضيف '||round(v_row.amount_yer,0)||' YER إلى رصيدك، ويمكنك مصارفته إلى USDT.' else coalesce(p_note,'تعذر قبول الطلب. تواصل مع الدعم.') end,case when v_decision='APPROVED' then 'fa-circle-check' else 'fa-circle-xmark' end,v_row.reference);
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(v_admin,'REVIEW_'||v_decision,'DEPOSIT',p_deposit_id::text,jsonb_build_object('note',p_note,'credited_currency','YER'));
end $$;

create or replace function public.create_withdraw_request_v2(
  p_amount_usdt numeric,p_payout_type text,p_destination text,p_network text default null,p_payment_method_id bigint default null,p_beneficiary_name text default null,p_funding_currency text default 'USDT'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user public.users%rowtype;v_rate public.exchange_rates%rowtype;v_reference text:=public.make_reference('WDR');
  v_fee numeric(20,8);v_net numeric(20,8);v_yer numeric(20,2);v_reserved_yer numeric(20,2):=0;v_id bigint;
  v_type text:=upper(p_payout_type);v_funding text:=upper(coalesce(p_funding_currency,'USDT'));
begin
  select * into v_user from public.users where user_id=public.current_profile_id() for update;
  if not found then raise exception 'account_inactive'; end if;
  if upper(coalesce(v_user.kyc_status,''))<>'APPROVED' then raise exception 'kyc_required'; end if;
  if p_amount_usdt is null or p_amount_usdt<=0 then raise exception 'invalid_amount'; end if;
  if v_type not in ('EXTERNAL_USDT','YER_PAYOUT') then raise exception 'invalid_payout_type'; end if;
  if v_funding not in ('USDT','YER') then raise exception 'invalid_funding_currency'; end if;
  if v_type='YER_PAYOUT' then v_funding:='USDT'; end if;
  if nullif(trim(p_destination),'') is null then raise exception 'destination_required'; end if;
  select * into v_rate from public.exchange_rates order by rate_id limit 1;

  if v_type='EXTERNAL_USDT' then
    if nullif(trim(p_network),'') is null then raise exception 'network_required'; end if;
    v_fee:=coalesce(v_rate.withdrawal_fee_usdt,0);
  else
    if p_payment_method_id is null or nullif(trim(p_beneficiary_name),'') is null then raise exception 'payout_details_required'; end if;
    if not exists(select 1 from public.payment_methods where method_id=p_payment_method_id and is_active=true and category in ('WITHDRAW','BOTH')) then raise exception 'payment_method_unavailable'; end if;
    v_fee:=round(p_amount_usdt*coalesce(v_rate.fee_percentage,0)/100,8);
  end if;
  if p_amount_usdt<=v_fee then raise exception 'amount_below_fee'; end if;
  v_net:=p_amount_usdt-v_fee;
  if v_type='YER_PAYOUT' then v_yer:=round(v_net*v_rate.buy_rate,2); end if;

  if v_funding='YER' then
    v_reserved_yer:=round(p_amount_usdt*v_rate.sell_rate,2);
    if coalesce(v_user.balance_yer,0)<v_reserved_yer then raise exception 'insufficient_yer_balance'; end if;
    update public.users set balance_yer=balance_yer-v_reserved_yer where user_id=v_user.user_id;
  else
    if coalesce(v_user.balance_usdt,0)<p_amount_usdt then raise exception 'insufficient_usdt_balance'; end if;
    update public.users set balance_usdt=balance_usdt-p_amount_usdt,balance=balance_usdt-p_amount_usdt where user_id=v_user.user_id;
  end if;

  insert into public.withdraw_requests(reference,user_id,payout_type,amount_usdt,fee_usdt,net_usdt,amount_yer,exchange_rate,network,destination,payment_method_id,beneficiary_name,status,funding_currency,reserved_yer)
  values(v_reference,v_user.user_id,v_type,p_amount_usdt,v_fee,v_net,v_yer,case when v_type='YER_PAYOUT' then v_rate.buy_rate when v_funding='YER' then v_rate.sell_rate else null end,p_network,p_destination,p_payment_method_id,p_beneficiary_name,'PENDING',v_funding,v_reserved_yer) returning withdraw_id into v_id;

  insert into public.transactions(reference,user_id,request_id,type,status,currency,amount_usdt,amount_yer,balance_after,description,metadata)
  values(v_reference,v_user.user_id,v_id,case when v_type='YER_PAYOUT' then 'YER_PAYOUT' else 'WITHDRAW' end,'PENDING',v_funding,p_amount_usdt,case when v_funding='YER' then v_reserved_yer else v_yer end,case when v_funding='YER' then v_user.balance_yer-v_reserved_yer else v_user.balance_usdt-p_amount_usdt end,case when v_type='YER_PAYOUT' then 'بيع USDT واستلام ريال يمني' else 'سحب USDT عبر '||p_network end,jsonb_build_object('fee_usdt',v_fee,'destination',p_destination,'funding_currency',v_funding));
  insert into public.notifications(user_id,audience,title,message,icon,reference) values(v_user.user_id,'USER','تم إنشاء طلب السحب','تم حجز المبلغ من رصيد '||v_funding||' والطلب '||v_reference||' بانتظار المراجعة.','fa-arrow-up',v_reference);
  insert into public.notifications(user_id,audience,title,message,icon,reference) values(null,'ADMIN','طلب سحب جديد','طلب '||v_reference||' بقيمة '||round(p_amount_usdt,2)||' USDT ومصدر الخصم '||v_funding||'.','fa-money-bill-transfer',v_reference);
  return jsonb_build_object('withdraw_id',v_id,'reference',v_reference,'status','PENDING','funding_currency',v_funding,'reserved_yer',v_reserved_yer,'reserved_usdt',case when v_funding='USDT' then p_amount_usdt else 0 end);
end $$;

create or replace function public.admin_review_withdraw(p_withdraw_id bigint,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_admin bigint:=public.current_profile_id();v_row public.withdraw_requests%rowtype;v_new_balance numeric(20,8);v_decision text:=upper(p_decision);v_funding text;
begin
  if not public.is_admin() then raise exception 'not_authorized'; end if;
  if v_decision not in ('APPROVED','REJECTED') then raise exception 'invalid_decision'; end if;
  select * into v_row from public.withdraw_requests where withdraw_id=p_withdraw_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if upper(v_row.status)<>'PENDING' then raise exception 'request_already_reviewed'; end if;
  v_funding:=upper(coalesce(v_row.funding_currency,'USDT'));
  if v_decision='REJECTED' then
    if v_funding='YER' then update public.users set balance_yer=coalesce(balance_yer,0)+coalesce(v_row.reserved_yer,0) where user_id=v_row.user_id returning balance_yer into v_new_balance;
    else update public.users set balance_usdt=coalesce(balance_usdt,0)+v_row.amount_usdt,balance=coalesce(balance_usdt,0)+v_row.amount_usdt where user_id=v_row.user_id returning balance_usdt into v_new_balance; end if;
  end if;
  update public.withdraw_requests set status=v_decision,admin_note=p_note,reviewed_by=v_admin,processed_at=now() where withdraw_id=p_withdraw_id;
  update public.transactions set status=case when v_decision='APPROVED' then 'COMPLETED' else 'REJECTED' end,balance_after=case when v_decision='REJECTED' then v_new_balance else balance_after end,updated_at=now() where request_id=p_withdraw_id and type in ('WITHDRAW','YER_PAYOUT');
  insert into public.notifications(user_id,audience,title,message,icon,reference) values(v_row.user_id,'USER',case when v_decision='APPROVED' then 'تم تنفيذ السحب' else 'تم رفض السحب' end,case when v_decision='APPROVED' then 'اكتمل طلب السحب '||v_row.reference||'.' else coalesce(p_note,'أعيد المبلغ المحجوز إلى رصيد '||v_funding||'.') end,case when v_decision='APPROVED' then 'fa-circle-check' else 'fa-rotate-left' end,v_row.reference);
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,details) values(v_admin,'REVIEW_'||v_decision,'WITHDRAW',p_withdraw_id::text,jsonb_build_object('note',p_note,'funding_currency',v_funding));
end $$;

-- Preserve the user's added proof column in the admin transaction table.
drop function if exists public.admin_search_transactions(text,integer);
create function public.admin_search_transactions(p_query text default null,p_limit integer default 200)
returns table(transaction_id bigint,reference text,type text,status text,currency text,amount_usdt numeric,amount_yer numeric,description text,created_at timestamptz,user_id bigint,full_name text,email text,request_id bigint,proof_path text)
language sql stable security definer set search_path=public as $$
  select t.transaction_id,t.reference,t.type::text,t.status::text,t.currency::text,t.amount_usdt,t.amount_yer,t.description,t.created_at,t.user_id,u.full_name::text,u.email::text,t.request_id,d.proof_path
  from public.transactions t join public.users u on u.user_id=t.user_id
  left join public.deposit_requests d on t.type='DEPOSIT' and d.deposit_id=t.request_id
  where public.is_admin() and (nullif(trim(p_query),'') is null or t.reference ilike '%'||trim(p_query)||'%' or u.email ilike '%'||trim(p_query)||'%' or u.phone_number ilike '%'||trim(p_query)||'%' or u.full_name ilike '%'||trim(p_query)||'%')
  order by t.created_at desc limit least(greatest(coalesce(p_limit,200),1),500)
$$;

revoke all on function public.update_my_profile(text,text) from public,anon;
revoke all on function public.update_my_preferences(text,text) from public,anon;
revoke all on function public.exchange_wallet_balance(text,numeric) from public,anon;
revoke all on function public.create_withdraw_request_v2(numeric,text,text,text,bigint,text,text) from public,anon;
revoke all on function public.admin_search_transactions(text,integer) from public,anon;
grant execute on function public.update_my_profile(text,text) to authenticated;
grant execute on function public.update_my_preferences(text,text) to authenticated;
grant execute on function public.exchange_wallet_balance(text,numeric) to authenticated;
grant execute on function public.create_withdraw_request_v2(numeric,text,text,text,bigint,text,text) to authenticated;
grant execute on function public.admin_search_transactions(text,integer) to authenticated;

commit;
