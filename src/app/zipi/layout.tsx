import type { ReactNode } from 'react';
import { getZipiOperator } from '@/lib/zipi-session';
import SignIn from './SignIn';

export default async function Layout({ children }: { children: ReactNode }) {
  return (await getZipiOperator()) ? children : <SignIn />;
}
