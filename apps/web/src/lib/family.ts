import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { api, ApiError } from './api';
import type { Account, Card, Category, Family, Member } from './types';

/** Família da rota (memorizada por requisição). 404 da API = não é membro → página 404. */
export const getFamily = cache(async (familyId: string) => {
  try {
    return await api<Family>(`/families/${familyId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

/** Listas usadas em filtros e formulários. */
export const getLookups = cache(async (familyId: string) => {
  const [categories, members, accounts, cards] = await Promise.all([
    api<Category[]>(`/families/${familyId}/categories`),
    api<Member[]>(`/families/${familyId}/members`),
    api<Account[]>(`/families/${familyId}/accounts`),
    api<Card[]>(`/families/${familyId}/cards`),
  ]);
  return { categories, members, accounts, cards };
});
