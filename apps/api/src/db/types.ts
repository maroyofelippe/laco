/**
 * Tipos das tabelas para o Kysely.
 * Convenções do driver (ver database.ts): DATE/DATETIME chegam como string,
 * DECIMAL como string (sem perda de precisão), BOOLEAN como 0/1 e JSON já desserializado.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Ts = ColumnType<string, string | undefined, string>;
type NullableTs = ColumnType<string | null, string | null | undefined, string | null>;
type Money = ColumnType<string, string | number, string | number>;
type DefaultMoney = ColumnType<string, string | number | undefined, string | number>;
type Bool = ColumnType<number, boolean | number | undefined, boolean | number>;
type Json<T> = ColumnType<T, string, string>;

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type TxType = 'INCOME' | 'EXPENSE' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'CARD_PAYMENT';
export type CategoryKind = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type LimitScope = 'FAMILY' | 'CATEGORY' | 'ACCOUNT' | 'CARD' | 'MEMBER';
export type LimitPeriod = 'WEEKLY' | 'MONTHLY' | 'CARD_CYCLE' | 'CUSTOM';

export interface UsersTable {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  email_verified_at: NullableTs;
  status: ColumnType<'ACTIVE' | 'BLOCKED', 'ACTIVE' | 'BLOCKED' | undefined>;
  failed_logins: Generated<number>;
  locked_until: NullableTs;
  created_at: Ts;
  updated_at: Ts;
}

export interface DevicesTable {
  id: string;
  user_id: string;
  platform: 'ANDROID' | 'WEB';
  fcm_token: string | null;
  app_version: Generated<string>;
  last_seen_at: Ts;
}

export interface RefreshTokensTable {
  id: string;
  user_id: string;
  token_hash: string;
  chain_id: string;
  client: 'ANDROID' | 'WEB';
  device_id: string | null;
  expires_at: string;
  revoked_at: NullableTs;
  replaced_by: string | null;
  created_at: Ts;
}

export interface FamiliesTable {
  id: string;
  name: string;
  currency: Generated<string>;
  timezone: Generated<string>;
  created_by: string;
  created_at: Ts;
  updated_at: Ts;
  deleted_at: NullableTs;
}

export interface FamilyMembersTable {
  family_id: string;
  user_id: string;
  role: Role;
  status: ColumnType<'ACTIVE' | 'SUSPENDED' | 'REMOVED', 'ACTIVE' | 'SUSPENDED' | 'REMOVED' | undefined>;
  display_name: string | null;
  joined_at: Ts;
}

export interface FamilyInvitationsTable {
  id: string;
  family_id: string;
  email: string;
  role: Exclude<Role, 'OWNER'>;
  token_hash: string;
  invited_by: string;
  status: ColumnType<'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED', 'PENDING' | undefined>;
  expires_at: string;
  accepted_by: string | null;
  created_at: Ts;
}

export interface MemberResourcePermissionsTable {
  family_id: string;
  user_id: string;
  resource_type: 'ACCOUNT' | 'CARD';
  resource_id: string;
  access: 'VIEW' | 'EDIT';
}

export interface CategoriesTable {
  id: string;
  family_id: string;
  parent_id: string | null;
  parent_key: ColumnType<string, never, never>;
  name: string;
  kind: CategoryKind;
  is_system: Bool;
  icon: string | null;
  color: string | null;
  is_active: Bool;
  version: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
}

export interface AccountsTable {
  id: string;
  family_id: string;
  owner_user_id: string | null;
  type: 'CHECKING' | 'SAVINGS' | 'CASH';
  name: string;
  bank_code: string | null;
  opening_balance: DefaultMoney;
  opening_date: string;
  visibility: ColumnType<'FAMILY' | 'RESTRICTED', 'FAMILY' | 'RESTRICTED' | undefined>;
  is_active: Bool;
  version: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  deleted_at: NullableTs;
}

export interface CreditCardsTable {
  id: string;
  family_id: string;
  holder_user_id: string | null;
  name: string;
  brand: string | null;
  last4: string | null;
  credit_limit: Money;
  closing_day: number;
  due_day: number;
  payment_account_id: string | null;
  visibility: ColumnType<'FAMILY' | 'RESTRICTED', 'FAMILY' | 'RESTRICTED' | undefined>;
  is_active: Bool;
  version: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  deleted_at: NullableTs;
}

export interface CardStatementsTable {
  id: string;
  family_id: string;
  card_id: string;
  reference_month: string;
  closing_date: string;
  due_date: string;
  total_amount: DefaultMoney;
  paid_amount: DefaultMoney;
  status: ColumnType<'OPEN' | 'CLOSED' | 'PAID' | 'PARTIAL' | 'OVERDUE', 'OPEN' | 'CLOSED' | 'PAID' | 'PARTIAL' | 'OVERDUE' | undefined>;
  created_at: Ts;
  updated_at: Ts;
}

export interface RecurrenceRulesTable {
  id: string;
  family_id: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval_n: Generated<number>;
  day_of_month: number | null;
  start_date: string;
  end_date: string | null;
  template: Json<Record<string, unknown>>;
  next_run_date: string;
  is_active: Bool;
  created_by: string;
  created_at: Ts;
  updated_at: Ts;
}

export interface InstallmentPlansTable {
  id: string;
  family_id: string;
  total_amount: Money;
  installments_count: number;
  first_date: string;
  description: string;
  created_at: Ts;
}

export interface TransactionsTable {
  id: string;
  family_id: string;
  type: TxType;
  amount: Money;
  description: string;
  normalized_description: string;
  category_id: string;
  account_id: string | null;
  card_id: string | null;
  statement_id: string | null;
  member_user_id: string | null;
  occurred_on: string;
  posted_on: string | null;
  status: ColumnType<'PENDING' | 'CLEARED', 'PENDING' | 'CLEARED' | undefined>;
  installment_plan_id: string | null;
  installment_number: number | null;
  recurrence_rule_id: string | null;
  transfer_group_id: string | null;
  source: ColumnType<'MANUAL' | 'PDF_IMPORT' | 'RECEIPT_OCR' | 'RECURRENCE', 'MANUAL' | 'PDF_IMPORT' | 'RECEIPT_OCR' | 'RECURRENCE' | undefined>;
  import_item_id: string | null;
  fingerprint: string;
  notes: string | null;
  created_by: string;
  version: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  deleted_at: NullableTs;
}

export interface BudgetsTable {
  id: string;
  family_id: string;
  category_id: string;
  reference_month: string;
  planned_amount: Money;
  updated_at: Ts;
}

export interface SpendingLimitsTable {
  id: string;
  family_id: string;
  name: string;
  scope_type: LimitScope;
  scope_id: string | null;
  include_subcategories: Bool;
  period: LimitPeriod;
  custom_start: string | null;
  custom_end: string | null;
  amount: Money;
  thresholds: Json<number[]>;
  notify_roles: Json<Role[]>;
  is_active: Bool;
  created_by: string;
  version: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
}

export interface SequencesTable {
  name: string;
  value: number;
}

export interface AlertsTable {
  id: string;
  family_id: string;
  limit_id: string;
  period_start: string;
  period_end: string;
  threshold_pct: number;
  level: 'WARNING' | 'EXCEEDED';
  consumed_amount: Money;
  limit_amount: Money;
  status: ColumnType<'ACTIVE' | 'RESOLVED' | 'DISMISSED', 'ACTIVE' | 'RESOLVED' | 'DISMISSED' | undefined>;
  seq: ColumnType<string, number | string, number | string>;
  created_at: Ts;
  resolved_at: NullableTs;
}

export interface AlertReceiptsTable {
  alert_id: string;
  user_id: string;
  delivered_at: NullableTs;
  push_sent_at: NullableTs;
  read_at: NullableTs;
}

export interface CategoryRulesTable {
  family_id: string;
  pattern: string;
  category_id: string;
  hits: Generated<number>;
  updated_at: Ts;
}

export interface FilesTable {
  id: string;
  family_id: string;
  kind: 'STATEMENT_PDF' | 'RECEIPT_IMAGE' | 'ATTACHMENT';
  storage_bucket: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: 'PENDING_UPLOAD' | 'STORED' | 'QUARANTINED' | 'DELETED';
  uploaded_by: string;
  created_at: Ts;
  retention_until: string | null;
}

export type ImportStatus = 'QUEUED' | 'PROCESSING' | 'REVIEW' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
export interface ImportBatchesTable {
  id: string;
  family_id: string;
  file_id: string;
  source_type: 'CARD_STATEMENT' | 'CHECKING' | 'SAVINGS';
  target_account_id: string | null;
  target_card_id: string | null;
  detected_bank: string | null;
  parser_used: string | null;
  status: ImportStatus;
  failure_reason: string | null;
  stats: Json<Record<string, unknown>> | null;
  created_by: string;
  created_at: Ts;
  confirmed_at: string | null;
}

export interface ImportItemsTable {
  id: string;
  family_id: string;
  batch_id: string;
  line_no: number;
  raw_text: string;
  occurred_on: string | null;
  description: string | null;
  normalized_description: string | null;
  amount: string | null;
  type: 'INCOME' | 'EXPENSE' | null;
  installment_hint: string | null;
  suggested_category_id: string | null;
  confidence: string | number;
  duplicate_of_tx_id: string | null;
  duplicate_score: string | number | null;
  duplicate_reason: string | null;
  decision: ColumnType<'PENDING' | 'ACCEPT' | 'SKIP', 'PENDING' | 'ACCEPT' | 'SKIP' | undefined>;
  created_tx_id: string | null;
}

export interface TransactionAttachmentsTable {
  transaction_id: string;
  file_id: string;
  family_id: string;
}

export interface AuditLogsTable {
  id: Generated<number>;
  family_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  diff: Json<unknown> | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Ts;
}

export interface IdempotencyKeysTable {
  user_id: string;
  idem_key: string;
  request_hash: string;
  response_status: number;
  response_body: Json<unknown>;
  created_at: Ts;
}

export interface Database {
  users: UsersTable;
  devices: DevicesTable;
  refresh_tokens: RefreshTokensTable;
  families: FamiliesTable;
  family_members: FamilyMembersTable;
  family_invitations: FamilyInvitationsTable;
  member_resource_permissions: MemberResourcePermissionsTable;
  categories: CategoriesTable;
  accounts: AccountsTable;
  credit_cards: CreditCardsTable;
  card_statements: CardStatementsTable;
  recurrence_rules: RecurrenceRulesTable;
  installment_plans: InstallmentPlansTable;
  transactions: TransactionsTable;
  budgets: BudgetsTable;
  spending_limits: SpendingLimitsTable;
  sequences: SequencesTable;
  alerts: AlertsTable;
  alert_receipts: AlertReceiptsTable;
  category_rules: CategoryRulesTable;
  files: FilesTable;
  import_batches: ImportBatchesTable;
  import_items: ImportItemsTable;
  transaction_attachments: TransactionAttachmentsTable;
  audit_logs: AuditLogsTable;
  idempotency_keys: IdempotencyKeysTable;
}

export type Transaction = Selectable<TransactionsTable>;
export type NewTransaction = Insertable<TransactionsTable>;
export type TransactionUpdate = Updateable<TransactionsTable>;
export type Category = Selectable<CategoriesTable>;
export type Account = Selectable<AccountsTable>;
export type CreditCard = Selectable<CreditCardsTable>;
export type SpendingLimit = Selectable<SpendingLimitsTable>;
export type Alert = Selectable<AlertsTable>;
