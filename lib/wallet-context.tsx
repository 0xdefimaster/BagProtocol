'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

// Minimal EIP-1193 typing — just enough of the injected provider interface
// (window.ethereum) that MetaMask, Coinbase Wallet, Rabby, etc. all expose.
interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const LAST_CONNECTED_KEY = 'bag-protocol:wallet-last-connected';

const CHAIN_NAMES: Record<string, string> = {
  '0x1': 'Ethereum',
  '0x2105': 'Base',
  '0xa4b1': 'Arbitrum',
  '0x89': 'Polygon',
};

export interface AuthUser {
  id: string;
  walletAddress: string;
  displayName: string | null;
}

interface WalletContextValue {
  isConnected: boolean;
  isConnecting: boolean;
  hasProvider: boolean;
  walletAddress: string;
  chainName: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** @deprecated use connect()/disconnect() — kept for existing call sites */
  toggleConnect: () => void;
  /** Wallet -> Sign Message -> Nonce -> Session -> User -> Supabase. Non-null once the server has verified a signature for the currently-connected address. */
  authUser: AuthUser | null;
  /** True once the initial /api/auth/session check has resolved — avoids flashing a "sign in" prompt before we know a cookie session already exists. */
  isAuthReady: boolean;
  isSigningIn: boolean;
  authError: string | null;
  /** Re-runs the nonce -> personal_sign -> verify flow for the connected wallet. Called automatically after connect(), but exposed for a manual "Sign in" retry button. */
  signIn: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState('');
  const [chainName, setChainName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(false);

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isConnected = walletAddress !== '';

  const applyChainId = useCallback((chainId: unknown) => {
    if (typeof chainId === 'string') {
      setChainName(CHAIN_NAMES[chainId] ?? `Chain ${parseInt(chainId, 16)}`);
    }
  }, []);

  // Silent reconnect on load: only queries accounts (no popup) if this tab
  // previously connected successfully.
  useEffect(() => {
    const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
    setHasProvider(!!provider);
    if (!provider) return;

    const wasConnected = window.localStorage.getItem(LAST_CONNECTED_KEY) === '1';
    if (!wasConnected) return;

    provider
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        const list = accounts as string[];
        if (list.length > 0) {
          setWalletAddress(list[0]);
          provider.request({ method: 'eth_chainId' }).then(applyChainId).catch(() => {});
        }
      })
      .catch(() => {});
  }, [applyChainId]);

  // On mount: restore any existing session cookie (survives a page reload —
  // this is the "same wallet, same device, no browser restart" case). Runs
  // once before the auto-sign-in effect below is allowed to fire, so a
  // valid session never triggers a redundant signature prompt.
  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data: { user: AuthUser | null }) => {
        if (data.user) setAuthUser(data.user);
      })
      .catch(() => {})
      .finally(() => setIsAuthReady(true));
  }, []);

  const signIn = useCallback(async () => {
    const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!provider || !walletAddress) {
      setAuthError('Connect a wallet first.');
      return;
    }

    setIsSigningIn(true);
    setAuthError(null);
    try {
      const nonceRes = await fetch('/api/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceData.error || 'Could not start sign-in.');

      const signature = (await provider.request({
        method: 'personal_sign',
        params: [nonceData.message, walletAddress],
      })) as string;

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, signature, nonce: nonceData.nonce }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Signature verification failed.');

      setAuthUser(verifyData.user as AuthUser);
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 4001
          ? 'Sign-in request was rejected.'
          : err instanceof Error
            ? err.message
            : 'Could not sign in.';
      setAuthError(message);
    } finally {
      setIsSigningIn(false);
    }
  }, [walletAddress]);

  // Auto-sign-in: once we know whether a session cookie already covers this
  // address (isAuthReady) and the connected wallet doesn't match the signed-
  // in user, kick off the nonce -> sign -> verify flow automatically so
  // "Connect Wallet" reads as one action from the user's side, even though
  // it's actually connect + sign under the hood.
  useEffect(() => {
    if (!isAuthReady || !walletAddress) return;
    if (authUser && authUser.walletAddress.toLowerCase() === walletAddress.toLowerCase()) return;
    signIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthReady, walletAddress]);

  // Keep in sync with wallet-side account/network switches.
  useEffect(() => {
    const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!provider) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        setWalletAddress('');
        window.localStorage.removeItem(LAST_CONNECTED_KEY);
      } else {
        setWalletAddress(accounts[0]);
      }
    };
    const onChainChanged = (...args: unknown[]) => applyChainId(args[0]);

    provider.on('accountsChanged', onAccountsChanged);
    provider.on('chainChanged', onChainChanged);
    return () => {
      provider.removeListener('accountsChanged', onAccountsChanged);
      provider.removeListener('chainChanged', onChainChanged);
    };
  }, [applyChainId]);

  const connect = useCallback(async () => {
    const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
    setError(null);

    if (!provider) {
      setError('No wallet extension found. Install MetaMask, Coinbase Wallet, or Rabby and refresh.');
      return;
    }

    setIsConnecting(true);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        window.localStorage.setItem(LAST_CONNECTED_KEY, '1');
        provider.request({ method: 'eth_chainId' }).then(applyChainId).catch(() => {});
      }
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 4001
          ? 'Connection request was rejected.'
          : 'Could not connect to your wallet. Please try again.';
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [applyChainId]);

  const disconnect = useCallback(() => {
    // EIP-1193 has no standard programmatic disconnect — this just clears
    // local state so the app treats the wallet as logged out. The server
    // session is explicitly torn down too, otherwise reconnecting the same
    // wallet later would silently skip the sign-in prompt.
    setWalletAddress('');
    setChainName(null);
    setAuthUser(null);
    setAuthError(null);
    window.localStorage.removeItem(LAST_CONNECTED_KEY);
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }, []);

  const toggleConnect = useCallback(() => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  }, [isConnected, connect, disconnect]);

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        isConnecting,
        hasProvider,
        walletAddress,
        chainName,
        error,
        connect,
        disconnect,
        toggleConnect,
        authUser,
        isAuthReady,
        isSigningIn,
        authError,
        signIn,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return ctx;
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
