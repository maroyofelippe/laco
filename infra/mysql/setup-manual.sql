-- Alternativa MANUAL ao `npm run db:setup` (ex.: MySQL Workbench ou `sudo mysql < setup-manual.sql`).
-- 1) Troque as duas senhas abaixo; 2) execute como root; 3) copie as senhas para apps/api/.env
--    (DB_PASSWORD e DB_MIGRATION_PASSWORD).

CREATE DATABASE IF NOT EXISTS laco      CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS laco_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Usuário da API: só manipula dados
CREATE USER IF NOT EXISTS 'laco_app'@'localhost' IDENTIFIED BY 'TROQUE_SENHA_APP';
CREATE USER IF NOT EXISTS 'laco_app'@'127.0.0.1' IDENTIFIED BY 'TROQUE_SENHA_APP';
GRANT SELECT, INSERT, UPDATE, DELETE ON laco.*      TO 'laco_app'@'localhost', 'laco_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON laco_test.* TO 'laco_app'@'localhost', 'laco_app'@'127.0.0.1';

-- Usuário de migrações, testes e backup: altera estrutura
CREATE USER IF NOT EXISTS 'laco_migrator'@'localhost' IDENTIFIED BY 'TROQUE_SENHA_MIGRATOR';
CREATE USER IF NOT EXISTS 'laco_migrator'@'127.0.0.1' IDENTIFIED BY 'TROQUE_SENHA_MIGRATOR';
GRANT ALL PRIVILEGES ON laco.*      TO 'laco_migrator'@'localhost', 'laco_migrator'@'127.0.0.1';
GRANT ALL PRIVILEGES ON laco_test.* TO 'laco_migrator'@'localhost', 'laco_migrator'@'127.0.0.1';
