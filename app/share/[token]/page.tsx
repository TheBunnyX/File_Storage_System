import { SharedFile } from '@/components/shared-file';
export const metadata = { title: 'Shared file — NexaFile', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; return <SharedFile token={token}/>; }
