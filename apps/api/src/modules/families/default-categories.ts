import type { CategoryKind } from '../../db/types';

/** Categorias criadas com cada nova família (podem ser renomeadas/desativadas depois).
 * Cores tiradas da paleta de gráficos da marca (packages/brand/tokens.json). */
export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; icon: string; color: string; system?: boolean; children?: string[] }[] = [
  { name: 'Moradia', kind: 'EXPENSE', icon: 'home', color: '#174B43', children: ['Aluguel', 'Condomínio', 'Manutenção'] },
  { name: 'Contas da casa', kind: 'EXPENSE', icon: 'bolt', color: '#2F6F6A', children: ['Energia', 'Água', 'Internet e telefone'] },
  { name: 'Mercado', kind: 'EXPENSE', icon: 'cart', color: '#E5A94D' },
  { name: 'Alimentação fora', kind: 'EXPENSE', icon: 'restaurant', color: '#B5643F', children: ['Delivery', 'Restaurantes'] },
  { name: 'Transporte', kind: 'EXPENSE', icon: 'car', color: '#3E6F8E', children: ['Combustível', 'Aplicativos', 'Transporte público'] },
  { name: 'Saúde', kind: 'EXPENSE', icon: 'health', color: '#5B8E7D', children: ['Farmácia', 'Plano de saúde', 'Consultas'] },
  { name: 'Educação', kind: 'EXPENSE', icon: 'school', color: '#8A6FA3' },
  { name: 'Lazer', kind: 'EXPENSE', icon: 'party', color: '#C98E2B' },
  { name: 'Vestuário', kind: 'EXPENSE', icon: 'shirt', color: '#9C4E63' },
  { name: 'Assinaturas', kind: 'EXPENSE', icon: 'repeat', color: '#7F958C' },
  { name: 'Impostos e taxas', kind: 'EXPENSE', icon: 'receipt', color: '#B08A5A' },
  { name: 'Outras despesas', kind: 'EXPENSE', icon: 'dots', color: '#9AA8A2' },
  { name: 'Salário', kind: 'INCOME', icon: 'wallet', color: '#1E7A5A' },
  { name: 'Freelance', kind: 'INCOME', icon: 'briefcase', color: '#6B8F3E' },
  { name: 'Rendimentos', kind: 'INCOME', icon: 'trending', color: '#2F6F6A' },
  { name: 'Outras receitas', kind: 'INCOME', icon: 'dots', color: '#7FAF95' },
  { name: 'Transferência', kind: 'TRANSFER', icon: 'swap', color: '#526A62', system: true },
  { name: 'Pagamento de fatura', kind: 'TRANSFER', icon: 'card', color: '#526A62', system: true },
];
