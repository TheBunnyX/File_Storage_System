import { redirect } from 'next/navigation';
export const metadata={title:'Administration — NexaFile',robots:{index:false,follow:false}};
// Administration lives in the workspace sidebar; keep old /admin links working.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }){
    const section = (await searchParams).section;
    redirect(`/?section=${encodeURIComponent(typeof section === 'string' ? section : 'Members')}`);
}
