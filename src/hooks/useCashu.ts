import { useEffect } from 'react';
import axios from 'axios';
import { useDispatch, useSelector } from 'react-redux';
import { lockBalance, setBalance, unlockBalance } from '@/redux/slices/Wallet.slice';
import {
   setError,
   setSending,
   setSuccess,
   setReceiving,
   resetStatus,
   setNotReceiving,
} from '@/redux/slices/ActivitySlice';
import { ProofData, Wallet } from '@/types';
import { MeltQuoteResponse, MeltTokensResponse, Proof } from '@cashu/cashu-ts';
import { useToast } from './useToast';
import { CashuWallet, CashuMint, SendResponse } from '@cashu/cashu-ts';
import { getNeededProofs, addBalance } from '@/utils/cashu';
import { RootState } from '@/redux/store';

export const useCashu = () => {
   let intervalCount = 0;

   const dispatch = useDispatch();
   const { addToast } = useToast();

   const getProofs = () => JSON.parse(window.localStorage.getItem('proofs') || '[]');
   const wallets = useSelector((state: RootState) => state.wallet.keysets);

   const deleteProofById = async (proofId: string) => {
      try {
         await axios
            .delete(`/api/proofs/${proofId}`)
            .then(response => {
               console.log(
                  `Proof with ID ${proofId} deleted drom database and moved into local storage.`,
               );
            })
            .catch(error => {
               console.log(error);
            });
      } catch (error) {
         console.error(`Failed to delete proof with ID ${proofId}:`, error);
      }
   };

   const requestMintInvoice = async (
      { unit, amount }: { unit: string; amount: number },
      keyset: Wallet,
   ) => {
      const wallet = new CashuWallet(new CashuMint(keyset.url), { ...keyset });

      const { quote, request } = await wallet.getMintQuote(amount);

      return { quote, request };
   };

   const handlePayInvoice = async (
      invoice: string,
      meltQuote: MeltQuoteResponse,
      estimatedFee: number,
      keyset: Wallet,
   ) => {
      const wallet = new CashuWallet(new CashuMint(keyset.url), { ...keyset });

      dispatch(setSending('Sending...'));
      dispatch(lockBalance());

      if (!invoice || isNaN(estimatedFee)) {
         addToast('Please enter an invoice and estimate the fee before submitting.', 'warning');
         dispatch(resetStatus());
         dispatch(unlockBalance());
         return;
      }

      const invoiceAmount = meltQuote.amount;
      const proofs = getNeededProofs(invoiceAmount + estimatedFee);
      let amountToPay = invoiceAmount + estimatedFee;

      const balance = proofs.reduce((acc: number, proof: Proof) => acc + proof.amount, 0);
      if (balance < amountToPay) {
         dispatch(setError('Insufficient balance to pay ' + amountToPay + ' sats'));
         addBalance(proofs);
         dispatch(unlockBalance());
         return;
      }

      try {
         let sendResponse: SendResponse;
         try {
            sendResponse = await wallet.send(amountToPay, proofs);
            addBalance(sendResponse.returnChange || []);
         } catch (e) {
            console.error('error swapping proofs', e);
            dispatch(setError('Payment failed'));
            addBalance(proofs);
            dispatch(unlockBalance());
            return;
         }
         if (sendResponse && sendResponse.send) {
            let invoiceResponse: MeltTokensResponse;
            try {
               invoiceResponse = await wallet.payLnInvoice(invoice, sendResponse.send, meltQuote);
            } catch (e) {
               console.error('error paying invoice', e);
               dispatch(setError('Payment failed'));
               dispatch(unlockBalance());
               addBalance(sendResponse.send);
               return;
            }
            if (!invoiceResponse || !invoiceResponse.isPaid) {
               dispatch(setError('Payment failed'));
               dispatch(unlockBalance());
            } else {
               addBalance(invoiceResponse.change || []);
               const newBalance = JSON.parse(localStorage.getItem('proofs') || '[]').reduce(
                  (acc: number, proof: Proof) => acc + proof.amount,
                  0,
               );

               const feePaid = balance - newBalance - invoiceAmount;
               const feeMessage =
                  feePaid > 0 ? ` + ${feePaid} sat${feePaid > 1 ? 's' : ''} fee` : '';

               dispatch(setSuccess(`Sent $${invoiceAmount / 100}!`));
            }
         }
      } catch (error) {
         console.error(error);
         addToast('An error occurred while trying to send.', 'error');
      } finally {
         dispatch(unlockBalance());
      }
   };

   const checkProofsValid = async (wallet: CashuWallet) => {
      const localProofs = getProofs();

      if (localProofs.length === 0) {
         return;
      }

      try {
         // Call the check method
         const spentProofs = await wallet.checkProofsSpent(localProofs);

         if (spentProofs.length > 0) {
            // Filter out non-spendable proofs
            const spendableProofs = localProofs.filter(
               (proof: Proof, index: number) => !spentProofs.includes(proof),
            );

            // If the spendable proofs have changed, update the local storage
            if (spendableProofs.length !== localProofs.length) {
               window.localStorage.setItem('proofs', JSON.stringify(spendableProofs));
            }
         } else {
            console.error('Failed to check proofs or invalid response');
         }
      } catch (error) {
         console.error('Failed to check proofs:', error);
      }
   };

   const updateProofsAndBalance = async () => {
      const pubkey = window.localStorage.getItem('pubkey');
      if (!pubkey) {
         return;
      }

      try {
         const pollingResponse = await axios.get(`/api/proofs/${pubkey}`);

         const isReceiving = pollingResponse.data?.receiving;

         if (isReceiving) {
            dispatch(setReceiving('Receiving...'));
         } else {
            dispatch(setNotReceiving());
         }

         const proofsFromDb = pollingResponse.data.proofs;
         const formattedProofs = proofsFromDb.map((proof: ProofData) => ({
            C: proof.C,
            amount: proof.amount,
            id: proof.proofId,
            secret: proof.secret,
         }));

         const localProofs = getProofs();
         const newProofs = formattedProofs.filter(
            (proof: ProofData) =>
               !localProofs.some((localProof: Proof) => localProof.secret === proof.secret),
         );

         let updatedProofs;
         if (newProofs.length > 0) {
            updatedProofs = [...localProofs, ...newProofs];
            window.localStorage.setItem('proofs', JSON.stringify(updatedProofs));

            const totalReceived = newProofs
               .map((proof: Proof) => proof.amount)
               .reduce((a: number, b: number) => a + b, 0);

            dispatch(setSuccess(`Received $${(totalReceived / 100).toFixed(2)}!`));

            // Delete new proofs from the database
            // get the index as well
            for (const proof of newProofs) {
               const proofId = proofsFromDb.find((p: ProofData) => p.secret === proof.secret).id;
               console.log('Deleting proof with ID:', proofId);
               await deleteProofById(proofId);
            }
         } else {
            updatedProofs = localProofs;
         }

         const newBalance =
            updatedProofs
               ?.map((proof: Proof) => proof.amount)
               .reduce((a: number, b: number) => a + b, 0) || 0;
         dispatch(setBalance({ usd: newBalance }));
      } catch (error) {
         console.error('Failed to update proofs and balance:', error);
      }
   };

   useEffect(() => {
      updateProofsAndBalance();

      const intervalId = setInterval(() => {
         updateProofsAndBalance();

         // Increment the counter
         intervalCount += 1;

         // Every fourth interval, call checkProofsValid
         if (intervalCount >= 4) {
            Object.values(wallets).forEach(w => {
               const wallet = new CashuWallet(new CashuMint(w.url), { ...w });
               checkProofsValid(wallet);
            });
            intervalCount = 0;
         }
      }, 3000); // Poll every 3 seconds

      return () => {
         clearInterval(intervalId);
      };
   }, [dispatch]);

   return { handlePayInvoice, requestMintInvoice };
};
