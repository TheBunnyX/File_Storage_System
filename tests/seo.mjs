import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {JSDOM} from 'jsdom';
import {serverRuntime} from '../scripts/runtime.mjs';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
const require=await serverRuntime(),{seoConfiguration,productMetadata}=require('./seo.js');
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++};
const configured={NODE_ENV:'production',SEO_INDEXING_ENABLED:'true'};
for(const SITE_URL of ['', 'not-a-url','http://127.0.0.1:3005','https://192.168.1.13','https://localhost','https://files.internal','https://example.com','https://user:secret@nexafile.company'])check(!seoConfiguration({...configured,SITE_URL}).indexable,'Unsafe or placeholder domain stays noindex');
check(!seoConfiguration({SITE_URL:'https://nexafile.company',SEO_INDEXING_ENABLED:'true',NODE_ENV:'development'}).indexable,'Development stays noindex');
check(!seoConfiguration({SITE_URL:'https://nexafile.company',NODE_ENV:'production'}).indexable,'Indexing requires explicit opt-in');
check(seoConfiguration({...configured,SITE_URL:'https://nexafile.company/path?value=1'}).site.href==='https://nexafile.company/','Canonical origin removes paths and query parameters');
check(seoConfiguration({...configured,SITE_URL:'https://nexafile.company'}).indexable,'Public HTTPS production domain supports explicit opt-in');
const old={SITE_URL:process.env.SITE_URL,SEO_INDEXING_ENABLED:process.env.SEO_INDEXING_ENABLED,NODE_ENV:process.env.NODE_ENV};
Object.assign(process.env,{...configured,SITE_URL:'https://nexafile.company'});
const metadata=productMetadata('th','Thai title','Thai description');
check(metadata.robots.index===true&&metadata.alternates.canonical==='https://nexafile.company/about/th','Public locale metadata has canonical and index opt-in');
check(Object.keys(metadata.alternates.languages).sort().join(',')==='en,th,x-default','Both languages and default are declared');
for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
const base='http://127.0.0.1:3112';let output='';
const dataDirectory=await mkdtemp(path.resolve('.test-data/seo-'));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3112'],{env:{...process.env,SITE_URL:'',SEO_INDEXING_ENABLED:'false',DATABASE_BACKEND:'sqlite',BLOB_BACKEND:'local',REDIS_ENABLED:'false',NEXAFILE_BACKUPS:'off',NEXAFILE_DATA_DIR:dataDirectory,NEXAFILE_DEMO:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});
server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
const get=async(url)=>fetch(base+url,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'Googlebot'}});
try {
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error(output);try{if((await get('/robots.txt')).ok){ready=true;break;}}catch{}await sleep(150);}assert.ok(ready,'Production server ready');
 for(const locale of ['en','th']){
  const response=await get('/about/'+locale);check(response.status===200,'Localized public page returns HTTP 200');
  const dom=new JSDOM(await response.text()),doc=dom.window.document;
  check(doc.querySelector('main').lang===locale&&doc.querySelectorAll('h1').length===1,'Server HTML contains one heading and correct content language');
  check(doc.querySelector('title').textContent.includes('NexaFile')&&doc.querySelector('meta[name="description"]').content.length>30,'Server-rendered title and description');
  check(doc.querySelector('meta[name="robots"]').content.includes('noindex'),'Local deployment remains noindex');
  check(!doc.querySelector('link[rel="canonical"]'),'No invented canonical domain');
  check(doc.querySelectorAll('a[hreflang]').length===2&&doc.querySelectorAll('details').length===3,'Crawlable language links and accessible FAQ');
  const schema=JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  check(schema['@type']==='SoftwareApplication'&&schema.inLanguage===locale&&!schema.aggregateRating,'Structured data describes actual product without invented ratings');
  const fonts=[...doc.querySelectorAll('link[as="font"]')];check(fonts.length===2&&fonts.every(f=>new URL(f.href,base).origin===base),'Both variable fonts are preloaded from the application');
  const image=new URL(doc.querySelector('meta[property="og:image"]').content,base);
  // Metadata base is loopback during local development; request the verified asset path on this isolated server.
  check(image.pathname==='/opengraph-image','Share preview references the generic product image');
  dom.window.close();
 }
 const image=await get('/opengraph-image'),png=Buffer.from(await image.arrayBuffer());check(image.ok&&image.headers.get('content-type').includes('image/png')&&png.readUInt32BE(16)===1200&&png.readUInt32BE(20)===630,'Open Graph image renders a 1200×630 PNG');
 check((await (await get('/robots.txt')).text()).includes('Disallow: /'),'Local robots.txt disallows indexing');
 const sitemap=await (await get('/sitemap.xml')).text();check(!sitemap.includes('<loc>')&&!sitemap.includes('/share/'),'Local sitemap is empty and never leaks shared file URLs');
 for(const path of ['/','/admin','/share/invalid-token','/api/auth/config']){const r=await get(path);check(r.headers.get('x-robots-tag')?.includes('noindex'),'Private route has noindex HTTP header: '+path);}
 check((await get('/about/fr')).status===404,'Unsupported language returns 404');
 console.log(`PASS: ${checks} SEO checks (production HTTP, metadata, privacy headers, fonts, sitemap, robots, and preview image).`);
} finally {if(server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;}}
