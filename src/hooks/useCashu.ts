import { useEffect } from 'react';
import axios from 'axios';
import { useDispatch } from 'react-redux';
import { lockBalance, setBalance, unlockBalance } from '@/redux/slices/CashuSlice';
import {
   setError,
   setSending,
   setSuccess,
   setReceiving,
   resetStatus,
   setNotReceiving,
} from '@/redux/slices/ActivitySlice';
import { ProofData } from '@/types';
import { Proof } from '@cashu/cashu-ts';
import { useToast } from './useToast';
import { getAmountFromInvoice } from '@/utils/bolt11';
import { CashuWallet, CashuMint, SendResponse, PayLnInvoiceResponse } from '@cashu/cashu-ts';
import { getNeededProofs, addBalance } from '@/utils/cashu';

export const useCashu = () => {
   let intervalCount = 0;

   const dispatch = useDispatch();
   const { addToast } = useToast();

   const mint = new CashuMint(process.env.NEXT_PUBLIC_CASHU_MINT_URL!);
   const wallet = new CashuWallet(mint);

   const getProofs = () => JSON.parse(window.localStorage.getItem('proofs') || '[]');

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

   const requestMintInvoice = async (amount: string) => {
      const { pr, hash } = await wallet.requestMint(parseInt(amount));

      if (!pr || !hash) {
         addToast('An error occurred while trying to receive.', 'error');
         return;
      }

      return { pr, hash };
   };

   const handlePayInvoice = async (invoice: string, estimatedFee: number) => {
      dispatch(setSending('Sending...'));
      dispatch(lockBalance());

      if (!invoice || isNaN(estimatedFee)) {
         addToast('Please enter an invoice and estimate the fee before submitting.', 'warning');
         dispatch(resetStatus());
         dispatch(unlockBalance());
         return;
      }

      const invoiceAmount = getAmountFromInvoice(invoice);
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
         } catch (e) {
            console.error('error swapping proofs', e);
            dispatch(setError('Payment failed'));
            addBalance(proofs);
            dispatch(unlockBalance());
            return;
         }
         if (sendResponse && sendResponse.send) {
            addBalance(sendResponse.returnChange || []);
            let invoiceResponse: PayLnInvoiceResponse;
            try {
               invoiceResponse = await wallet.payLnInvoice(invoice, sendResponse.send);
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
               const updatedProofs = sendResponse.returnChange || [];

               if (invoiceResponse.change) {
                  invoiceResponse.change.forEach((change: Proof) => updatedProofs.push(change));
               }

               addBalance(updatedProofs);

               const newBalance = updatedProofs
                  .map((proof: Proof) => proof.amount)
                  .reduce((a: number, b: number) => a + b, 0);

               const feePaid = balance - newBalance - invoiceAmount;
               const feeMessage =
                  feePaid > 0 ? ` + ${feePaid} sat${feePaid > 1 ? 's' : ''} fee` : '';

               dispatch(
                  setSuccess(
                     `Sent ${invoiceAmount} sat${invoiceAmount === 1 ? '' : 's'}${feeMessage}`,
                  ),
               );
            }
         }
      } catch (error) {
         console.error(error);
         addToast('An error occurred while trying to send.', 'error');
      } finally {
         dispatch(unlockBalance());
      }
   };

   const checkProofsValid = async () => {
      const localProofs = getProofs();

      if (localProofs.length === 0) {
         return;
      }

      // Create checkPayload from the local proofs
      const checkPayload = {
         proofs: localProofs.map((proof: Proof) => ({ secret: proof.secret })),
      };

      try {
         // Call the check method
         const response = await mint.check(checkPayload);

         // Handle the response
         if (response && response.spendable) {
            // Filter out non-spendable proofs
            const spendableProofs = localProofs.filter(
               (proof: Proof, index: number) => response.spendable[index],
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

            dispatch(setSuccess(`Received ${totalReceived} sat${totalReceived === 1 ? '' : 's'}!`));

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
         dispatch(setBalance(newBalance));
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
            checkProofsValid();
            intervalCount = 0;
         }
      }, 3000); // Poll every 3 seconds

      return () => {
         clearInterval(intervalId);
      };
   }, [dispatch]);

   return { handlePayInvoice, requestMintInvoice };
};
