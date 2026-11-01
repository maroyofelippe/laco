'use client';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// Cores da marca (packages/brand/tokens.json): receitas em verde, despesas em terracota suave
const C = { receita: '#1E7A5A', despesa: '#B5643F', verde: '#174B43', grade: '#EFEBE2', eixo: '#526A62', cursor: '#F7F5EF', semCor: '#9AA8A2' };
const short = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(v));
const fmt = (v: unknown) => brl2.format(Number(v));

export function TimeseriesChart({ data }: { data: { label: string; income: number; expense: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={C.grade} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke={C.eixo} />
        <YAxis tickFormatter={short} tickLine={false} axisLine={false} fontSize={12} stroke={C.eixo} width={56} />
        <Tooltip contentStyle={{ borderRadius: 10, borderColor: '#E2DCCF', fontFamily: 'inherit' }} formatter={fmt} cursor={{ fill: C.cursor }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="income" name="Receitas" fill={C.receita} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="expense" name="Despesas" fill={C.despesa} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryChart({ data }: { data: { name: string; amount: number; color: string | null; pct: number }[] }) {
  const top = data.slice(0, 8);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="h-[170px] w-[170px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={top} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={1.5} stroke="none">
              {top.map((d, i) => <Cell key={i} fill={d.color ?? C.semCor} />)}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 10, borderColor: '#E2DCCF', fontFamily: 'inherit' }} formatter={fmt} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-sm">
        {top.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color ?? C.semCor }} />
            <span className="min-w-0 flex-1 truncate text-apoio">{d.name}</span>
            <span className="shrink-0 tabular text-tinta">{brl.format(d.amount)}</span>
            <span className="w-11 shrink-0 text-right text-xs tabular text-apoio">{d.pct.toLocaleString('pt-BR')}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MemberChart({ data }: { data: { name: string; expense: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 96, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={13} width={70} stroke={C.eixo} />
        <Tooltip contentStyle={{ borderRadius: 10, borderColor: '#E2DCCF', fontFamily: 'inherit' }} formatter={fmt} cursor={{ fill: C.cursor }} />
        <Bar dataKey="expense" name="Gastos" fill={C.verde} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', formatter: (v: number) => brl.format(v), fontSize: 12, fill: C.eixo }} />
      </BarChart>
    </ResponsiveContainer>
  );
}
