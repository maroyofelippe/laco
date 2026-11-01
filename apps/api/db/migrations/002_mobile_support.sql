-- 002_mobile_support.sql
-- Suporte ao app Laço: regras de categorização aprendidas, recorrências idempotentes,
-- índices para sincronização incremental e metadados de importação.

-- Regras aprendidas nas confirmações (descrição normalizada → categoria)
CREATE TABLE category_rules (
  family_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  pattern VARCHAR(120) NOT NULL,
  category_id CHAR(36) CHARSET ascii COLLATE ascii_bin NOT NULL,
  hits INT NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (family_id, pattern),
  CONSTRAINT fk_cr_category FOREIGN KEY (family_id, category_id) REFERENCES categories(family_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Uma ocorrência por regra e data: geração de recorrências pode rodar várias vezes sem duplicar.
-- Ocorrência excluída pelo usuário (deleted_at) também não é recriada.
ALTER TABLE transactions ADD UNIQUE KEY uq_tx_recurrence (recurrence_rule_id, occurred_on);

ALTER TABLE recurrence_rules
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD KEY ix_rr_family (family_id, is_active);

-- Sincronização incremental do app (updated_at >= cursor)
ALTER TABLE categories ADD KEY ix_cat_sync (family_id, updated_at);
ALTER TABLE accounts ADD KEY ix_acc_sync (family_id, updated_at);
ALTER TABLE credit_cards ADD KEY ix_card_sync (family_id, updated_at);

ALTER TABLE import_items
  ADD COLUMN normalized_description VARCHAR(200) NULL AFTER description,
  ADD COLUMN duplicate_reason VARCHAR(20) NULL AFTER duplicate_score;
