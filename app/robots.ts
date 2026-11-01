import type { MetadataRoute } from 'next';
import { seoConfiguration } from '@/lib/seo';
export default function robots(): MetadataRoute.Robots {
  const {site,indexable}=seoConfiguration();
  return indexable&&site?{rules:{userAgent:'*',allow:'/',disallow:'/api/'},sitemap:new URL('/sitemap.xml',site).href}:{rules:{userAgent:'*',disallow:'/'}};
}
