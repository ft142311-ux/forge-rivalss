import { redirect } from 'next/navigation';

/** Legacy route: tournament instances are now served by the canonical daily tournament system. */
export default function LegacyTournamentRoute() {
  redirect('/tournaments/open');
}
