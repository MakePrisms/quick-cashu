import React, { useState, useEffect } from 'react';
import Balance from '@/components/Balance';
import Receive from '@/components/buttons/lightning/Receive';
import Send from '@/components/buttons/lightning/Send';
import { CashuMint, CashuWallet, Proof } from '@cashu/cashu-ts';
import { useNwc } from '@/hooks/useNwc';
import { useCashu } from '@/hooks/useCashu';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { useAppDispatch } from '@/redux/store';
import { initializeUser } from '@/redux/slices/UserSlice';
import Disclaimer from '@/components/Disclaimer';
import ActivityIndicator from '@/components/ActivityIndicator';
import { setSuccess } from '@/redux/slices/ActivitySlice';
import ZapBotButton from '@/components/buttons/ZapBotButton';

export default function Home() {
   const [showZapBotButton, setShowZapBotButton] = useState(false);

   const dispatch = useAppDispatch();

   useEffect(() => {
      dispatch(initializeUser());

      if (!window.localStorage.getItem('nwa')) {
         setShowZapBotButton(true);
      }

      let params = new URL(document.location.href).searchParams;
      if (params.get('just_connected') === 'true') {
         dispatch(setSuccess('Connected to Zap Bot!'));
         setShowZapBotButton(false);
      }
   }, [dispatch]);

   useEffect(() => {
      const checkProofs = async () => {
         const proofs: Proof[] = JSON.parse(window.localStorage.getItem('proofs') || '[]');
         if (!proofs.length) return;
         const unspendable = await wallet.checkProofsSpent(proofs);
         console.log('unspendable', unspendable);
         const spendable = proofs.filter(p => !unspendable.some(u => u.secret === p.secret));
         console.log(`## Removing ${unspendable.length} unspendable proofs`, unspendable);
         window.localStorage.setItem('proofs', JSON.stringify(spendable));
      };

      const checkMint = () => {
         const oldMint = localStorage.getItem('mint');
         console.log('oldMint', oldMint);
         const currentMint = process.env.NEXT_PUBLIC_CASHU_MINT_URL;
         if (!currentMint) throw new Error('Set mint url in .env file');
         if (!oldMint || oldMint !== currentMint) {
            // reset the proofs because from old mint
            window.localStorage.removeItem('proofs');
            window.localStorage.setItem('mint', currentMint);
         }
      };

      checkMint();
      checkProofs();
   }, []);

   const mint = new CashuMint(process.env.NEXT_PUBLIC_CASHU_MINT_URL!);

   const wallet = new CashuWallet(mint);

   const balance = useSelector((state: RootState) => state.cashu.balance);

   useNwc();
   useCashu();

   return (
      <main className='flex flex-col items-center justify-center mx-auto min-h-screen'>
         <Balance balance={balance} />
         <ActivityIndicator />
         <div className='py-8 w-full'>
            <div className='flex flex-row justify-center mx-auto'>
               <Receive />
               <Send wallet={wallet} />
            </div>
         </div>
         <footer className='fixed inset-x-0 bottom-0 text-center p-4 shadow-md flex  flex-col items-center justify-center'>
            {showZapBotButton && <ZapBotButton />}
            <Disclaimer />
         </footer>
      </main>
   );
}
