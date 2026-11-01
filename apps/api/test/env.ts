import 'dotenv/config';
// Banco isolado para testes; carregado antes de qualquer import da aplicação
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'laco_test';
