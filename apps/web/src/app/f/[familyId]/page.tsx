import { redirect } from 'next/navigation';

export default async function FamilyIndex({ params }: { params: Promise<{ familyId: string }> }) {
  redirect(`/f/${(await params).familyId}/dashboard`);
}
