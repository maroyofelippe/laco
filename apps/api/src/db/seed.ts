/**
 * Popula o banco local com dados de demonstração usando os próprios serviços da API
 * (faturas, alertas e auditoria são gerados pelas regras de negócio reais).
 *
 *   npm run db:seed
 *
 * Usuários (senha Demo@1234):
 *   marco@laco.example  OWNER   da Família Demo
 *   ana@laco.example    ADMIN   da Família Demo
 *   leo@laco.example    MEMBER  da Família Demo (vê só contas FAMILY + as permitidas)
 *   carla@outra.laco.example OWNER   de outra família (para testar isolamento)
 */
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import { AppModule } from '../app.module';
import type { FamilyContext, RequestMeta } from '../common/context';
import { addMonths, monthOf, today } from '../common/util';
import { AccountsController } from '../modules/accounts/accounts.controller';
import { AuthService } from '../modules/auth/auth.service';
import { BudgetsController } from '../modules/budgets/budgets.controller';
import { CardsController } from '../modules/cards/cards.controller';
import { FamiliesService } from '../modules/families/families.service';
import { LimitsController } from '../modules/limits/limits.controller';
import { LimitsService } from '../modules/limits/limits.service';
import { TransactionsService } from '../modules/transactions/transactions.service';
import { DB, type Db } from './database';

const PASSWORD = 'Demo@1234';
const meta: RequestMeta = { ip: '127.0.0.1', userAgent: 'seed', requestId: 'seed' };

// Gerador determinístico para que o seed seja reproduzível
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pickOne = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const money = (min: number, max: number) => (min + rnd() * (max - min)).toFixed(2);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Db>(DB);
  const auth = app.get(AuthService);
  const families = app.get(FamiliesService);
  const accounts = app.get(AccountsController);
  const cards = app.get(CardsController);
  const txs = app.get(TransactionsService);
  const limits = app.get(LimitsController);
  const budgets = app.get(BudgetsController);

  const exists = await db.selectFrom('users').select('id').where('email', '=', 'marco@laco.example').executeTakeFirst();
  if (exists) {
    console.log('Seed já aplicado (use npm run db:reset para recriar).');
    await app.close();
    return;
  }

  console.log('Criando usuários...');
  const marco = (await auth.register({ name: 'Marco', email: 'marco@laco.example', password: PASSWORD }, meta)).user;
  const ana = (await auth.register({ name: 'Ana', email: 'ana@laco.example', password: PASSWORD }, meta)).user;
  const leo = (await auth.register({ name: 'Léo', email: 'leo@laco.example', password: PASSWORD }, meta)).user;
  const carla = (await auth.register({ name: 'Carla', email: 'carla@outra.laco.example', password: PASSWORD }, meta)).user;

  console.log('Criando famílias e convites...');
  const fam = await families.create({ id: marco.id, email: marco.email }, 'Família Demo', meta);
  const owner: FamilyContext = { familyId: fam.id, userId: marco.id, role: 'OWNER' };
  for (const [u, role] of [[ana, 'ADMIN'], [leo, 'MEMBER']] as const) {
    const inv = (await families.invite(owner, { email: u.email, role }, meta)) as { devInviteToken: string };
    await families.accept({ id: u.id, email: u.email }, inv.devInviteToken, meta);
  }
  const other = await families.create({ id: carla.id, email: carla.email }, 'Família Outra', meta);

  const cats = await db.selectFrom('categories').select(['id', 'name', 'kind']).where('family_id', '=', fam.id).execute();
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;

  console.log('Criando contas e cartões...');
  const t = today();
  const start = `${monthOf(addMonths(t, -5))}-01`;
  const conjunta = await accounts.create(owner, { type: 'CHECKING', name: 'Itaú conta conjunta', bankCode: '341', openingBalance: '6500.00', openingDate: start }, meta);
  const poupanca = await accounts.create(owner, { type: 'SAVINGS', name: 'Poupança Caixa', bankCode: '104', openingBalance: '18000.00', openingDate: start }, meta);
  const contaMarco = await accounts.create(owner, { type: 'CHECKING', name: 'Nubank Marco (pessoal)', bankCode: '260', openingBalance: '2200.00', openingDate: start, ownerUserId: marco.id, visibility: 'RESTRICTED' }, meta);
  const nubank = await cards.create(owner, { name: 'Nubank', brand: 'Mastercard', last4: '4821', creditLimit: '9000.00', closingDay: 3, dueDay: 10, paymentAccountId: conjunta.id }, meta);
  const itauVisa = await cards.create(owner, { name: 'Itaú Visa', brand: 'Visa', last4: '1077', creditLimit: '6000.00', closingDay: 25, dueDay: 5, paymentAccountId: conjunta.id }, meta);
  await accounts.create({ familyId: other.id, userId: carla.id, role: 'OWNER' }, { type: 'CHECKING', name: 'Conta da Carla', openingBalance: '999.00', openingDate: start }, meta);

  console.log('Gerando lançamentos de 6 meses...');
  const people = [marco.id, ana.id, leo.id];
  const asUser = (userId: string): FamilyContext => ({ familyId: fam.id, userId, role: userId === marco.id ? 'OWNER' : userId === ana.id ? 'ADMIN' : 'MEMBER' });
  const merchants: Record<string, string[]> = {
    Mercado: ['Supermercado Dia', 'Carrefour', 'Pão de Açúcar', 'Assaí Atacadista', 'Hortifruti'],
    Delivery: ['iFood', 'Rappi', 'Zé Delivery'],
    Restaurantes: ['Restaurante Sabor Caseiro', 'Pizzaria Bella', 'Sushi Kenzo'],
    Combustível: ['Posto Shell', 'Posto Ipiranga'],
    Aplicativos: ['Uber', '99'],
    Farmácia: ['Drogasil', 'Droga Raia'],
    Lazer: ['Cinemark', 'Ingresso.com', 'Parque Villa-Lobos estacionamento'],
    Vestuário: ['Renner', 'C&A', 'Centauro'],
  };
  let count = 0;
  for (let m = 5; m >= 0; m--) {
    const ym = monthOf(addMonths(t, -m));
    const day = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;
    const lastDay = m === 0 ? Number(t.slice(8, 10)) : 28;
    const inMonth = (d: number) => d <= lastDay;

    // Receitas e contas fixas
    if (inMonth(5)) {
      await txs.create(asUser(marco.id), { type: 'INCOME', amount: '9800.00', description: 'Salário Marco', categoryId: cat('Salário'), accountId: conjunta.id, occurredOn: day(5) }, meta);
      await txs.create(asUser(ana.id), { type: 'INCOME', amount: '7200.00', description: 'Salário Ana', categoryId: cat('Salário'), accountId: conjunta.id, occurredOn: day(5), memberUserId: ana.id }, meta);
      count += 2;
    }
    if (inMonth(10)) {
      await txs.create(asUser(marco.id), { type: 'EXPENSE', amount: '2950.00', description: 'Aluguel', categoryId: cat('Aluguel'), accountId: conjunta.id, occurredOn: day(10) }, meta);
      await txs.create(asUser(marco.id), { type: 'EXPENSE', amount: '680.00', description: 'Condomínio', categoryId: cat('Condomínio'), accountId: conjunta.id, occurredOn: day(10) }, meta);
      await txs.create(asUser(ana.id), { type: 'EXPENSE', amount: money(180, 320), description: 'Enel energia', categoryId: cat('Energia'), accountId: conjunta.id, occurredOn: day(12), memberUserId: ana.id }, meta);
      await txs.create(asUser(ana.id), { type: 'EXPENSE', amount: '129.90', description: 'Vivo Fibra', categoryId: cat('Internet e telefone'), cardId: nubank.id, occurredOn: day(8), memberUserId: ana.id }, meta);
      await txs.create(asUser(marco.id), { type: 'EXPENSE', amount: '55.90', description: 'Netflix', categoryId: cat('Assinaturas'), cardId: nubank.id, occurredOn: day(15) }, meta);
      await txs.create(asUser(marco.id), { type: 'EXPENSE', amount: '890.00', description: 'Escola de inglês Léo', categoryId: cat('Educação'), accountId: conjunta.id, occurredOn: day(10), memberUserId: leo.id }, meta);
      count += 6;
    }
    if (inMonth(20) && m % 2 === 0) {
      await txs.create(asUser(marco.id), { type: 'INCOME', amount: money(800, 2400), description: 'Projeto freelance', categoryId: cat('Freelance'), accountId: contaMarco.id, occurredOn: day(20) }, meta);
      count++;
    }
    if (inMonth(6)) {
      await txs.createTransfer(asUser(marco.id), { fromAccountId: conjunta.id, toAccountId: poupanca.id, amount: '1000.00', occurredOn: day(6), description: 'Reserva mensal' }, meta);
    }

    // Gastos variáveis
    const variable: [string, number, number, number][] = [
      ['Mercado', 7, 90, 420], ['Delivery', 5, 35, 110], ['Restaurantes', 2, 80, 260], ['Combustível', 3, 150, 280],
      ['Aplicativos', 5, 14, 48], ['Farmácia', 2, 25, 140], ['Lazer', 2, 40, 220], ['Vestuário', 1, 90, 380],
    ];
    for (const [name, n, min, max] of variable) {
      for (let i = 0; i < n; i++) {
        const d = 1 + Math.floor(rnd() * 27);
        if (!inMonth(d)) continue;
        const who = pickOne(people);
        const useCard = rnd() < 0.7;
        await txs.create(
          asUser(who),
          {
            type: 'EXPENSE', amount: money(min, max), description: pickOne(merchants[name]), categoryId: cat(name),
            ...(useCard ? { cardId: rnd() < 0.6 ? nubank.id : itauVisa.id } : { accountId: conjunta.id }),
            occurredOn: day(d), memberUserId: who, source: rnd() < 0.15 ? 'RECEIPT_OCR' : 'MANUAL',
          },
          meta,
        );
        count++;
      }
    }
  }

  // Compras parceladas
  await txs.createInstallments(asUser(marco.id), { description: 'Notebook', totalAmount: '4800.00', installments: 10, firstDate: `${monthOf(addMonths(t, -3))}-14`, categoryId: cat('Outras despesas'), cardId: nubank.id }, meta);
  await txs.createInstallments(asUser(ana.id), { description: 'Geladeira', totalAmount: '3299.00', installments: 6, firstDate: `${monthOf(addMonths(t, -1))}-22`, categoryId: cat('Manutenção'), cardId: itauVisa.id, memberUserId: ana.id }, meta);

  // Pagamento das faturas já vencidas
  const due = await db.selectFrom('card_statements').selectAll().where('family_id', '=', fam.id).where('due_date', '<', t).execute();
  for (const st of due) {
    if (Number(st.total_amount) > 0) await cards.pay(owner, st.card_id, st.id, { accountId: conjunta.id, amount: st.total_amount, paidOn: st.due_date }, meta);
  }

  // Leo enxerga a conta pessoal do Marco só para leitura (exemplo de permissão por recurso)
  await families.setPermissions(owner, leo.id, { items: [{ resourceType: 'ACCOUNT', resourceId: contaMarco.id, access: 'VIEW' }] }, meta);

  console.log('Criando orçamentos e limites...');
  const month = monthOf(t);
  await budgets.set(owner, { month }, {
    items: [
      { categoryId: cat('Moradia'), plannedAmount: '3700.00' }, { categoryId: cat('Mercado'), plannedAmount: '1600.00' },
      { categoryId: cat('Alimentação fora'), plannedAmount: '700.00' }, { categoryId: cat('Transporte'), plannedAmount: '800.00' },
      { categoryId: cat('Lazer'), plannedAmount: '350.00' }, { categoryId: cat('Saúde'), plannedAmount: '300.00' },
    ],
  }, meta);
  await limits.create(owner, { name: 'Mercado - mensal', scopeType: 'CATEGORY', scopeId: cat('Mercado'), period: 'MONTHLY', amount: '1600.00', thresholds: [80, 100] }, meta);
  await limits.create(owner, { name: 'Alimentação fora - mensal', scopeType: 'CATEGORY', scopeId: cat('Alimentação fora'), period: 'MONTHLY', amount: '500.00', thresholds: [80, 100] }, meta);
  await limits.create(owner, { name: 'Gasto total da família', scopeType: 'FAMILY', period: 'MONTHLY', amount: '12000.00', thresholds: [80, 100] }, meta);
  await limits.create(owner, { name: 'Nubank - por fatura', scopeType: 'CARD', scopeId: nubank.id, period: 'CARD_CYCLE', amount: '3500.00', thresholds: [70, 90, 100] }, meta);
  await limits.create(owner, { name: 'Lazer - semanal', scopeType: 'CATEGORY', scopeId: cat('Lazer'), period: 'WEEKLY', amount: '150.00' }, meta);

  // Reavalia limites considerando o mês corrente inteiro
  const created = await app.get(LimitsService).reevaluateAll(fam.id);
  const alerts = await db.selectFrom('alerts').select(sql<number>`COUNT(*)`.as('n')).where('family_id', '=', fam.id).executeTakeFirstOrThrow();

  console.log(`\nPronto: ${count} lançamentos avulsos + parcelas/transferências, ${Number(alerts.n)} alerta(s) (${created.length} na reavaliação final).`);
  console.log(`Família Demo: ${fam.id}`);
  console.log('Logins (senha Demo@1234): marco@laco.example (OWNER), ana@laco.example (ADMIN), leo@laco.example (MEMBER), carla@outra.laco.example (outra família)');
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
