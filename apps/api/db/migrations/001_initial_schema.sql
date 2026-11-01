-- 001_initial_schema.sql
-- Esquema inicial do FinFamília (MySQL 8.0+).
-- Identificadores: UUIDv7 em CHAR(36) ASCII (simplificação da fase local; ver README).
-- Toda tabela de negócio carrega family_id e as FKs entre elas são compostas
-- (family_id, x_id): o banco recusa referências cruzadas entre famílias.

-- ---------------------------------------------------------------- Identidade
CREATE TABLE users (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at DATETIME(3) NULL,
  status ENUM('ACTIVE','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  failed_logins SMALLINT NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE devices (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  platform ENUM('ANDROID','WEB') NOT NULL DEFAULT 'ANDROID',
  fcm_token VARCHAR(512) NULL,
  app_version VARCHAR(20) NOT NULL DEFAULT '0',
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_devices_fcm (fcm_token),
  CONSTRAINT fk_dev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARSET ascii NOT NULL,
  chain_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  client ENUM('ANDROID','WEB') NOT NULL,
  device_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  replaced_by CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rt_hash (token_hash),
  KEY ix_rt_user (user_id, revoked_at),
  KEY ix_rt_chain (chain_id),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------------- Família
CREATE TABLE families (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  timezone VARCHAR(40) NOT NULL DEFAULT 'America/Sao_Paulo',
  created_by CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  CONSTRAINT fk_fam_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE family_members (
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  role ENUM('OWNER','ADMIN','MEMBER','VIEWER') NOT NULL,
  status ENUM('ACTIVE','SUSPENDED','REMOVED') NOT NULL DEFAULT 'ACTIVE',
  display_name VARCHAR(60) NULL,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (family_id, user_id),
  KEY ix_fm_user (user_id, status),
  CONSTRAINT fk_fm_family FOREIGN KEY (family_id) REFERENCES families(id),
  CONSTRAINT fk_fm_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE family_invitations (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(255) NOT NULL,
  role ENUM('ADMIN','MEMBER','VIEWER') NOT NULL,
  token_hash CHAR(64) CHARSET ascii NOT NULL,
  invited_by CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('PENDING','ACCEPTED','REVOKED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  expires_at DATETIME(3) NOT NULL,
  accepted_by CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_inv_token (token_hash),
  KEY ix_inv_family_status (family_id, status),
  KEY ix_inv_email (email, status),
  CONSTRAINT fk_inv_family FOREIGN KEY (family_id) REFERENCES families(id),
  CONSTRAINT fk_inv_by FOREIGN KEY (invited_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Visibilidade por recurso: contas/cartões RESTRICTED
CREATE TABLE member_resource_permissions (
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  resource_type ENUM('ACCOUNT','CARD') NOT NULL,
  resource_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  access ENUM('VIEW','EDIT') NOT NULL,
  PRIMARY KEY (family_id, user_id, resource_type, resource_id),
  CONSTRAINT fk_mrp_member FOREIGN KEY (family_id, user_id) REFERENCES family_members(family_id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------- Cadastros
CREATE TABLE categories (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  parent_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  parent_key CHAR(36) CHARSET ascii COLLATE ascii_bin GENERATED ALWAYS AS (COALESCE(parent_id, '')) STORED,
  name VARCHAR(60) NOT NULL,
  kind ENUM('INCOME','EXPENSE','TRANSFER') NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  icon VARCHAR(40) NULL,
  color CHAR(7) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cat_fid (family_id, id),
  UNIQUE KEY uq_cat_name (family_id, kind, parent_key, name),
  CONSTRAINT fk_cat_family FOREIGN KEY (family_id) REFERENCES families(id),
  CONSTRAINT fk_cat_parent FOREIGN KEY (family_id, parent_id) REFERENCES categories(family_id, id)
) ENGINE=InnoDB;

CREATE TABLE accounts (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  owner_user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  type ENUM('CHECKING','SAVINGS','CASH') NOT NULL,
  name VARCHAR(80) NOT NULL,
  bank_code CHAR(3) NULL,
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL,
  visibility ENUM('FAMILY','RESTRICTED') NOT NULL DEFAULT 'FAMILY',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_acc_fid (family_id, id),
  KEY ix_acc_family (family_id, deleted_at),
  CONSTRAINT fk_acc_family FOREIGN KEY (family_id) REFERENCES families(id),
  CONSTRAINT fk_acc_owner FOREIGN KEY (family_id, owner_user_id) REFERENCES family_members(family_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE credit_cards (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  holder_user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  name VARCHAR(80) NOT NULL,
  brand VARCHAR(20) NULL,
  last4 CHAR(4) NULL,
  credit_limit DECIMAL(15,2) NOT NULL,
  closing_day TINYINT NOT NULL,
  due_day TINYINT NOT NULL,
  payment_account_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  visibility ENUM('FAMILY','RESTRICTED') NOT NULL DEFAULT 'FAMILY',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_card_fid (family_id, id),
  KEY ix_card_family (family_id, deleted_at),
  CONSTRAINT ck_card_days CHECK (closing_day BETWEEN 1 AND 31 AND due_day BETWEEN 1 AND 31),
  CONSTRAINT ck_card_limit CHECK (credit_limit >= 0),
  CONSTRAINT ck_card_last4 CHECK (last4 IS NULL OR last4 REGEXP '^[0-9]{4}$'),
  CONSTRAINT fk_card_family FOREIGN KEY (family_id) REFERENCES families(id),
  CONSTRAINT fk_card_holder FOREIGN KEY (family_id, holder_user_id) REFERENCES family_members(family_id, user_id),
  CONSTRAINT fk_card_payacc FOREIGN KEY (family_id, payment_account_id) REFERENCES accounts(family_id, id)
) ENGINE=InnoDB;

CREATE TABLE card_statements (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  card_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  reference_month CHAR(7) NOT NULL,
  closing_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('OPEN','CLOSED','PAID','PARTIAL','OVERDUE') NOT NULL DEFAULT 'OPEN',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_stmt_fid (family_id, id),
  UNIQUE KEY uq_stmt_card_month (card_id, reference_month),
  KEY ix_stmt_due (family_id, due_date, status),
  CONSTRAINT fk_stmt_card FOREIGN KEY (family_id, card_id) REFERENCES credit_cards(family_id, id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------ Movimento
CREATE TABLE recurrence_rules (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  frequency ENUM('DAILY','WEEKLY','MONTHLY','YEARLY') NOT NULL,
  interval_n SMALLINT NOT NULL DEFAULT 1,
  day_of_month TINYINT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  template JSON NOT NULL,
  next_run_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rr_fid (family_id, id),
  KEY ix_rr_next (is_active, next_run_date),
  CONSTRAINT fk_rr_family FOREIGN KEY (family_id) REFERENCES families(id)
) ENGINE=InnoDB;

CREATE TABLE installment_plans (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  installments_count TINYINT NOT NULL,
  first_date DATE NOT NULL,
  description VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ip_fid (family_id, id),
  CONSTRAINT ck_ip_count CHECK (installments_count BETWEEN 2 AND 72),
  CONSTRAINT fk_ip_family FOREIGN KEY (family_id) REFERENCES families(id)
) ENGINE=InnoDB;

CREATE TABLE transactions (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  type ENUM('INCOME','EXPENSE','TRANSFER_IN','TRANSFER_OUT','CARD_PAYMENT') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  description VARCHAR(200) NOT NULL,
  normalized_description VARCHAR(200) NOT NULL,
  category_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  card_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  statement_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  member_user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  occurred_on DATE NOT NULL,
  posted_on DATE NULL,
  status ENUM('PENDING','CLEARED') NOT NULL DEFAULT 'CLEARED',
  installment_plan_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  installment_number TINYINT NULL,
  recurrence_rule_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  transfer_group_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  source ENUM('MANUAL','PDF_IMPORT','RECEIPT_OCR','RECURRENCE') NOT NULL DEFAULT 'MANUAL',
  import_item_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  fingerprint CHAR(64) CHARSET ascii NOT NULL,
  notes TEXT NULL,
  created_by CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_tx_fid (family_id, id),
  UNIQUE KEY uq_tx_installment (installment_plan_id, installment_number),
  KEY ix_tx_period (family_id, occurred_on, deleted_at),
  KEY ix_tx_category (family_id, category_id, occurred_on),
  KEY ix_tx_account (family_id, account_id, occurred_on),
  KEY ix_tx_card (family_id, card_id, statement_id),
  KEY ix_tx_member (family_id, member_user_id, occurred_on),
  KEY ix_tx_fingerprint (family_id, fingerprint),
  KEY ix_tx_sync (family_id, updated_at),
  FULLTEXT KEY ft_tx_desc (description),
  CONSTRAINT ck_tx_amount CHECK (amount > 0),
  CONSTRAINT ck_tx_one_means CHECK ((account_id IS NOT NULL) + (card_id IS NOT NULL) = 1),
  CONSTRAINT fk_tx_category FOREIGN KEY (family_id, category_id) REFERENCES categories(family_id, id),
  CONSTRAINT fk_tx_account FOREIGN KEY (family_id, account_id) REFERENCES accounts(family_id, id),
  CONSTRAINT fk_tx_card FOREIGN KEY (family_id, card_id) REFERENCES credit_cards(family_id, id),
  CONSTRAINT fk_tx_stmt FOREIGN KEY (family_id, statement_id) REFERENCES card_statements(family_id, id),
  CONSTRAINT fk_tx_plan FOREIGN KEY (family_id, installment_plan_id) REFERENCES installment_plans(family_id, id),
  CONSTRAINT fk_tx_rule FOREIGN KEY (family_id, recurrence_rule_id) REFERENCES recurrence_rules(family_id, id),
  CONSTRAINT fk_tx_member FOREIGN KEY (family_id, member_user_id) REFERENCES family_members(family_id, user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------- Controle
CREATE TABLE budgets (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  category_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  reference_month CHAR(7) NOT NULL,
  planned_amount DECIMAL(15,2) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_budget (family_id, category_id, reference_month),
  CONSTRAINT ck_budget_amount CHECK (planned_amount >= 0),
  CONSTRAINT fk_budget_cat FOREIGN KEY (family_id, category_id) REFERENCES categories(family_id, id)
) ENGINE=InnoDB;

CREATE TABLE spending_limits (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  scope_type ENUM('FAMILY','CATEGORY','ACCOUNT','CARD','MEMBER') NOT NULL,
  scope_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  include_subcategories BOOLEAN NOT NULL DEFAULT TRUE,
  period ENUM('WEEKLY','MONTHLY','CARD_CYCLE','CUSTOM') NOT NULL,
  custom_start DATE NULL,
  custom_end DATE NULL,
  amount DECIMAL(15,2) NOT NULL,
  thresholds JSON NOT NULL,
  notify_roles JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_lim_fid (family_id, id),
  KEY ix_lim_scope (family_id, scope_type, scope_id, is_active),
  CONSTRAINT ck_lim_amount CHECK (amount > 0),
  CONSTRAINT ck_lim_scope CHECK ((scope_type = 'FAMILY') = (scope_id IS NULL)),
  CONSTRAINT ck_lim_custom CHECK (period <> 'CUSTOM' OR (custom_start IS NOT NULL AND custom_end IS NOT NULL AND custom_end >= custom_start)),
  CONSTRAINT fk_lim_family FOREIGN KEY (family_id) REFERENCES families(id)
) ENGINE=InnoDB;

-- Sequência global para o cursor incremental de alertas (MySQL não tem SEQUENCE)
CREATE TABLE sequences (
  name VARCHAR(40) NOT NULL PRIMARY KEY,
  value BIGINT NOT NULL
) ENGINE=InnoDB;
INSERT INTO sequences (name, value) VALUES ('alert_seq', 0);

CREATE TABLE alerts (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  limit_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  threshold_pct SMALLINT NOT NULL,
  level ENUM('WARNING','EXCEEDED') NOT NULL,
  consumed_amount DECIMAL(15,2) NOT NULL,
  limit_amount DECIMAL(15,2) NOT NULL,
  status ENUM('ACTIVE','RESOLVED','DISMISSED') NOT NULL DEFAULT 'ACTIVE',
  seq BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  UNIQUE KEY uq_alert_seq (seq),
  UNIQUE KEY uq_alert_dedup (limit_id, period_start, threshold_pct),
  KEY ix_alert_family (family_id, status, created_at),
  KEY ix_alert_fseq (family_id, seq),
  CONSTRAINT fk_alert_limit FOREIGN KEY (family_id, limit_id) REFERENCES spending_limits(family_id, id)
) ENGINE=InnoDB;

CREATE TABLE alert_receipts (
  alert_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  delivered_at DATETIME(3) NULL,
  push_sent_at DATETIME(3) NULL,
  read_at DATETIME(3) NULL,
  PRIMARY KEY (alert_id, user_id),
  KEY ix_ar_user (user_id, read_at),
  CONSTRAINT fk_ar_alert FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------- Arquivos e importação
CREATE TABLE files (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('STATEMENT_PDF','RECEIPT_IMAGE','ATTACHMENT') NOT NULL,
  storage_bucket VARCHAR(63) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) CHARSET ascii NOT NULL,
  status ENUM('PENDING_UPLOAD','STORED','QUARANTINED','DELETED') NOT NULL,
  uploaded_by CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  retention_until DATE NULL,
  UNIQUE KEY uq_file_fid (family_id, id),
  UNIQUE KEY uq_file_key (storage_bucket, storage_key),
  KEY ix_file_hash (family_id, sha256),
  CONSTRAINT ck_file_size CHECK (size_bytes <= 20971520),
  CONSTRAINT fk_file_family FOREIGN KEY (family_id) REFERENCES families(id)
) ENGINE=InnoDB;

CREATE TABLE import_batches (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  file_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  source_type ENUM('CARD_STATEMENT','CHECKING','SAVINGS') NOT NULL,
  target_account_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  target_card_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  detected_bank VARCHAR(40) NULL,
  parser_used VARCHAR(60) NULL,
  status ENUM('QUEUED','PROCESSING','REVIEW','CONFIRMED','FAILED','CANCELLED') NOT NULL,
  failure_reason VARCHAR(255) NULL,
  stats JSON NULL,
  created_by CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  confirmed_at DATETIME(3) NULL,
  UNIQUE KEY uq_ib_fid (family_id, id),
  KEY ix_ib_status (family_id, status),
  CONSTRAINT fk_ib_file FOREIGN KEY (family_id, file_id) REFERENCES files(family_id, id),
  CONSTRAINT fk_ib_account FOREIGN KEY (family_id, target_account_id) REFERENCES accounts(family_id, id),
  CONSTRAINT fk_ib_card FOREIGN KEY (family_id, target_card_id) REFERENCES credit_cards(family_id, id)
) ENGINE=InnoDB;

CREATE TABLE import_items (
  id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  batch_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  line_no INT NOT NULL,
  raw_text VARCHAR(500) NOT NULL,
  occurred_on DATE NULL,
  description VARCHAR(200) NULL,
  amount DECIMAL(15,2) NULL,
  type ENUM('INCOME','EXPENSE') NULL,
  installment_hint VARCHAR(10) NULL,
  suggested_category_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  confidence DECIMAL(4,3) NOT NULL,
  duplicate_of_tx_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  duplicate_score DECIMAL(4,3) NULL,
  decision ENUM('PENDING','ACCEPT','SKIP') NOT NULL DEFAULT 'PENDING',
  created_tx_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  UNIQUE KEY uq_ii_line (batch_id, line_no),
  CONSTRAINT fk_ii_batch FOREIGN KEY (family_id, batch_id) REFERENCES import_batches(family_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE transaction_attachments (
  transaction_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  file_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (transaction_id, file_id),
  CONSTRAINT fk_ta_tx FOREIGN KEY (family_id, transaction_id) REFERENCES transactions(family_id, id),
  CONSTRAINT fk_ta_file FOREIGN KEY (family_id, file_id) REFERENCES files(family_id, id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------ Operação
CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  actor_user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id CHAR(36) CHARSET ascii COLLATE ascii_bin NULL,
  diff JSON NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  request_id VARCHAR(40) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_family (family_id, created_at),
  KEY ix_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;

CREATE TABLE idempotency_keys (
  user_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  idem_key VARCHAR(64) CHARSET ascii NOT NULL,
  request_hash CHAR(64) CHARSET ascii NOT NULL,
  response_status SMALLINT NOT NULL,
  response_body JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, idem_key),
  KEY ix_idem_created (created_at)
) ENGINE=InnoDB;
