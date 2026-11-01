import type { Db } from '../../db/database';
import { rulePattern } from './similarity';

/** Dicionário inicial: palavra na descrição → nome da categoria padrão (se existir e estiver ativa). */
const KEYWORDS: [RegExp, string][] = [
  [/\b(ifood|rappi|ze delivery|aiqfome)\b/, 'Delivery'],
  [/\b(uber|99 ?app|99pop|cabify)\b/, 'Aplicativos'],
  [/\b(posto|shell|ipiranga|petrobras|br mania|combust)/, 'Combustível'],
  [/\b(supermerc|mercado|carrefour|assai|atacad|pao de acucar|hortifruti|sacolao|dia brasil)/, 'Mercado'],
  [/\b(drogasil|droga raia|drogaria|farmac|pague menos)/, 'Farmácia'],
  [/\b(netflix|spotify|disney|prime video|amazon prime|youtube premium|hbo|max\.com|globoplay|deezer|icloud|google one)\b/, 'Assinaturas'],
  [/\b(restaurante|lanchonete|pizzaria|padaria|burger|mc ?donald|outback|sushi|bar e)/, 'Restaurantes'],
  [/\b(enel|light|cemig|copel|celesc|energia|eletropaulo)\b/, 'Energia'],
  [/\b(sabesp|cedae|copasa|saneamento|agua e esgoto)\b/, 'Água'],
  [/\b(vivo|claro|tim|oi fibra|net servicos|internet)\b/, 'Internet e telefone'],
  [/\b(aluguel)\b/, 'Aluguel'],
  [/\b(condominio)\b/, 'Condomínio'],
  [/\b(escola|faculdade|universidade|curso|mensalidade escolar)\b/, 'Educação'],
  [/\b(cinema|cinemark|ingresso|teatro|show)\b/, 'Lazer'],
  [/\b(renner|riachuelo|c ?& ?a|zara|centauro|shein|hering)\b/, 'Vestuário'],
  [/\b(iof|tarifa|anuidade|juros|multa|encargo)\b/, 'Impostos e taxas'],
  [/\b(salario|folha|pagto salario)\b/, 'Salário'],
  [/\b(rendimento|juros poupanca|remuneracao)\b/, 'Rendimentos'],
];

/**
 * Sugere categoria: (1) regra aprendida com confirmações anteriores da família;
 * (2) dicionário de estabelecimentos; (3) nenhuma — a revisão exige escolher.
 */
export class CategorySuggester {
  private rules = new Map<string, string>();
  private byName = new Map<string, { id: string; kind: string }>();

  static async load(db: Db, familyId: string) {
    const s = new CategorySuggester();
    for (const r of await db.selectFrom('category_rules as r').innerJoin('categories as c', 'c.id', 'r.category_id').select(['r.pattern', 'r.category_id']).where('r.family_id', '=', familyId).where('c.is_active', '=', 1).execute()) {
      s.rules.set(r.pattern, r.category_id);
    }
    for (const c of await db.selectFrom('categories').select(['id', 'name', 'kind']).where('family_id', '=', familyId).where('is_active', '=', 1).execute()) {
      s.byName.set(c.name, { id: c.id, kind: c.kind });
    }
    return s;
  }

  suggest(normalized: string, type: 'INCOME' | 'EXPENSE' | null): string | null {
    const learned = this.rules.get(rulePattern(normalized));
    if (learned) return learned;
    for (const [re, name] of KEYWORDS) {
      if (!re.test(normalized)) continue;
      const c = this.byName.get(name);
      if (c && (!type || c.kind === type)) return c.id;
    }
    return null;
  }
}
