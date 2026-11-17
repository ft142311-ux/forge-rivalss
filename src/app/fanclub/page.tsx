import { redirect } from 'next/navigation';

/**
 * The legacy fanclub screen used a client-only no-op store action and a
 * hard-coded season_1 / leagues_v2 data path. Keep the old URL working, but
 * route managers to the server-authoritative fan actions and current data model.
 */
export default function LegacyFanclubRedirect() {
  redirect('/fans');
}
