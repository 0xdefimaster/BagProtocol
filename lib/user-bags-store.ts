'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bag } from '@/types';

const STORAGE_KEY = 'bag-protocol:user-bags';

function readStoredBags(): Bag[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Bag[]) : [];
  } catch {
    return [];
  }
}

function writeStoredBags(bags: Bag[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bags));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

// Notify other hook instances in the same tab (storage events only fire cross-tab).
const LOCAL_EVENT = 'bag-protocol:user-bags-updated';

export function useUserBags() {
  const [userBags, setUserBags] = useState<Bag[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setUserBags(readStoredBags());
    setHydrated(true);

    const sync = () => setUserBags(readStoredBags());
    window.addEventListener('storage', sync);
    window.addEventListener(LOCAL_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(LOCAL_EVENT, sync);
    };
  }, []);

  const addBag = useCallback((bag: Bag) => {
    const next = [bag, ...readStoredBags()];
    writeStoredBags(next);
    setUserBags(next);
    window.dispatchEvent(new Event(LOCAL_EVENT));
  }, []);

  return { userBags, addBag, hydrated };
}
