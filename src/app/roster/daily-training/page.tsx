'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DailyTrainingPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/roster/training');
  }, [router]);
  return null;
}
