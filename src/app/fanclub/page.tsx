import { redirect } from 'next/navigation';

/**
 * The legacy fanclub screen used a client-only no-op store action and an
 * obsolete data path. Keep the old URL working, but
 * route managers to the server-authoritative fan actions and current data model.
 */
export default function LegacyFanclubRedirect() {
  redirect('/fans');
}
