'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AwardsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/rankings?view=season_top');
  }, [router]);
  return null;
}
