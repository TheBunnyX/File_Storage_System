import type { Metadata } from 'next';

export function seoConfiguration(env: Record<string,string|undefined> = process.env) {
  let site: URL | null = null;
  try {
    const candidate=new URL(env.SITE_URL || '');
    const host=candidate.hostname.toLowerCase();
    const reserved=host==='localhost'||!host.includes('.')||/^[\d.]+$/.test(host)||host.includes(':')||/\.(localhost|local|internal|test|invalid|example)$/.test(host)||/^(example\.(com|org|net))$/.test(host);
    if(candidate.protocol==='https:'&&!candidate.username&&!candidate.password&&!reserved){candidate.pathname='/';candidate.search='';candidate.hash='';site=candidate;}
  } catch { /* An unset or invalid domain keeps the deployment out of search. */ }
  return {site,indexable:!!site&&env.SEO_INDEXING_ENABLED==='true'&&env.NODE_ENV==='production'};
}

export const privateRobots = {index:false,follow:false,noarchive:true} as const;
export const siteMetadata: Metadata = {
  title:{default:'NexaFile — Your files, beautifully organized',template:'%s | NexaFile'},
  description:'A private file workspace with team sharing, document search, and version history.',
  applicationName:'NexaFile',
  metadataBase:seoConfiguration().site || new URL('http://127.0.0.1:3005'),
  robots:privateRobots,
  openGraph:{type:'website',siteName:'NexaFile',title:'NexaFile',description:'Organize, share, and find your documents in one workspace.',images:[{url:'/opengraph-image',width:1200,height:630,alt:'NexaFile — Your private document workspace'}]},
  twitter:{card:'summary_large_image',title:'NexaFile',description:'Your private document workspace.',images:['/opengraph-image']},
};

export function productMetadata(locale:'en'|'th',title:string,description:string): Metadata {
  const {site,indexable}=seoConfiguration();
  const url=site?new URL(`/about/${locale}`,site).href:undefined;
  return {
    title,description,robots:indexable?{index:true,follow:true}:privateRobots,
    alternates:site?{canonical:url,languages:{en:new URL('/about/en',site).href,th:new URL('/about/th',site).href,'x-default':new URL('/about/en',site).href}}:undefined,
    openGraph:{title,description,type:'website',siteName:'NexaFile',locale:locale==='th'?'th_TH':'en_US',alternateLocale:[locale==='th'?'en_US':'th_TH'],url,images:[{url:'/opengraph-image',width:1200,height:630,alt:'NexaFile — Your private document workspace'}]},
    twitter:{card:'summary_large_image',title,description,images:['/opengraph-image']},
  };
}
