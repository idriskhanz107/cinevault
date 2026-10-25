import { Link } from 'react-router-dom';
import { PageContainer } from '../components/ui';

const PAGES: Record<string, { title: string; body: string[] }> = {
  about: {
    title: 'About CineVault',
    body: [
      'CineVault is a movie database and streaming service. Administrators upload and curate titles; members can browse, build a watchlist, rate movies and pick up where they left off on any device.',
      'Video is delivered through Cloudflare Stream and catalogue data is stored in Supabase.',
    ],
  },
  contact: {
    title: 'Contact',
    body: [
      'Questions, takedown requests or feedback? Replace this text with your support email address before launching.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      'This is a template and must be reviewed by legal counsel before production use.',
      'We store your email address, display name, watchlist, ratings and viewing history to provide the service. Data is protected by row-level security so only you can read your personal records. You can delete your viewing history from your profile at any time.',
      'We do not sell personal data.',
    ],
  },
  terms: {
    title: 'Terms of Service',
    body: [
      'This is a template and must be reviewed by legal counsel before production use.',
      'You may only upload and stream content that you own or are licensed to distribute. Accounts used to violate copyright or the law may be suspended.',
    ],
  },
};

export default function StaticPage({ page }: { page: keyof typeof PAGES }) {
  const { title, body } = PAGES[page]!;
  return (
    <PageContainer className="max-w-3xl py-10">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <div className="mt-5 space-y-4 text-fog-300">{body.map((p) => <p key={p}>{p}</p>)}</div>
      <Link to="/" className="mt-8 inline-block text-gold-400 hover:underline">← Back home</Link>
    </PageContainer>
  );
}

export function NotFound() {
  return (
    <PageContainer className="py-24 text-center">
      <p className="text-6xl font-bold text-gold-400">404</p>
      <h1 className="mt-3 text-2xl font-bold">Page not found</h1>
      <Link to="/" className="btn btn-primary mt-6">Go home</Link>
    </PageContainer>
  );
}
