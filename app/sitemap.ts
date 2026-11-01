import type { MetadataRoute } from 'next';
import { seoConfiguration } from '@/lib/seo';
export default function sitemap(): MetadataRoute.Sitemap {
  const {site,indexable}=seoConfiguration();
  if(!site||!indexable)return [];
  const languages={en:new URL('/about/en',site).href,th:new URL('/about/th',site).href,'x-default':new URL('/about/en',site).href};
  return (['en','th'] as const).map(locale=>({url:languages[locale],alternates:{languages}}));
}
