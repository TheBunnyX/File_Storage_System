import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NexaFile',
    short_name: 'NexaFile',
    description: 'Your files, organized and easy to find.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6faff',
    theme_color: '#2279ff',
    icons: [
      { src: '/icons/nexafile-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/nexafile-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
