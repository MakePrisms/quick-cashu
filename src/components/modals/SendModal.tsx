import { useState } from 'react';
import { Modal, Spinner, Button } from 'flowbite-react';
import { getAmountFromInvoice } from '@/utils/bolt11';
import { useCashu } from '@/hooks/useCashu';
import { useToast } from '@/hooks/useToast';
import { CashuWallet } from '@cashu/cashu-ts';
import { getInvoiceFromLightningAddress } from '@/utils/lud16';

interface SendModalProps {
   isSendModalOpen: boolean;
   setIsSendModalOpen: (value: boolean) => void;
   wallet: CashuWallet;
}

enum Tabs {
   Destination = 'destination',
   Amount = 'amount',
   Fee = 'fee',
   Send = 'send',
}

export const SendModal = ({ isSendModalOpen, setIsSendModalOpen, wallet }: SendModalProps) => {
   const [currentTab, setCurrentTab] = useState<Tabs>(Tabs.Destination);
   const [destination, setDestination] = useState('');
   const [amountSat, setAmountSat] = useState(0);
   const [invoice, setInvoice] = useState('');
   const [isProcessing, setIsProcessing] = useState(false);
   const [estimatedFee, setEstimatedFee] = useState<number | null>(null);

   const { addToast } = useToast();

   const { handlePayInvoice } = useCashu();

   const handleBackClick = () => {
      if (currentTab === Tabs.Amount) {
         setCurrentTab(Tabs.Destination);
      } else if (currentTab === Tabs.Fee) {
         if (destination.startsWith('lnbc')) {
            setCurrentTab(Tabs.Destination);
         } else if (destination.includes('@')) {
            setCurrentTab(Tabs.Amount);
         }
      }
   };

   const estimateFee = async (invoice: string) => {
      setIsProcessing(true);

      try {
         const fee = await wallet.getFee(invoice);

         setEstimatedFee(fee);
         addToast(`Estimated fee: ${fee} sats`, 'info');
         setCurrentTab(Tabs.Fee);
      } catch (error) {
         console.error(error);
         addToast('An error occurred while estimating the fee.', 'error');
      } finally {
         setIsProcessing(false);
      }
   };

   const handleSend = async () => {
      setIsSendModalOpen(false);

      try {
         await handlePayInvoice(invoice, estimatedFee as number);
      } catch (error) {
         console.error(error);
         addToast('An error occurred while paying the invoice.', 'error');
      }

      // reset modal state
      setCurrentTab(Tabs.Destination);
      setDestination('');
      setInvoice('');
      setEstimatedFee(null);
   };

   const handleLightningAddress = async () => {
      if (!amountSat) {
         addToast('Please enter an amount.', 'warning');
         return;
      }

      try {
         const invoice = await getInvoiceFromLightningAddress(destination, amountSat * 1000);
         setInvoice(invoice);
         await estimateFee(invoice);
      } catch (error) {
         console.error(error);
         addToast('An error occurred while fetching the invoice.', 'error');
      }
   };

   const handleDestination = async () => {
      if (!destination) {
         addToast('Please enter a destination.', 'warning');
         return;
      }

      if (destination.startsWith('lnbc')) {
         setInvoice(destination);
         await estimateFee(destination);
         setCurrentTab(Tabs.Fee);
      } else if (destination.includes('@')) {
         setCurrentTab(Tabs.Amount);
      }
   };

   const renderTab = () => {
      switch (currentTab) {
         case Tabs.Destination:
            return (
               <>
                  <Modal.Body>
                     <input
                        className='form-control block w-full px-3 py-1.5 text-base font-normal text-gray-700 bg-white bg-clip-padding border border-solid border-gray-300 rounded transition ease-in-out m-0 focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none mb-4'
                        type='text'
                        placeholder='Lightning address or invoice'
                        value={destination}
                        onChange={e => setDestination(e.target.value)}
                     />
                     <div className='flex justify-end'>
                        <Button color='info' onClick={handleDestination}>
                           Continue
                        </Button>
                     </div>
                  </Modal.Body>
               </>
            );

         case Tabs.Amount:
            return (
               <Modal.Body>
                  <input
                     className='form-control block w-full px-3 py-1.5 text-base font-normal text-gray-700 bg-white bg-clip-padding border border-solid border-gray-300 rounded transition ease-in-out m-0 focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none mb-4'
                     type='number'
                     placeholder='Amount in sats'
                     value={amountSat || ''}
                     onChange={e => setAmountSat(() => parseInt(e.target.value, 10))}
                  />
                  <div className='flex items-center flex-row justify-around'>
                     <Button color='failure' onClick={handleBackClick}>
                        Back
                     </Button>
                     <Button color='info' onClick={handleLightningAddress}>
                        Continue
                     </Button>
                  </div>
               </Modal.Body>
            );

         case Tabs.Fee:
            return (
               <Modal.Body>
                  <div className=' text-sm text-black mb-4'>
                     Estimated Fee: {estimatedFee} sats
                     <br />
                     Total amount to pay: {getAmountFromInvoice(invoice) + estimatedFee!} sats
                  </div>
                  <div className='flex justify-around'>
                     <Button color='failure' onClick={handleBackClick}>
                        Back
                     </Button>
                     <Button color='success' onClick={handleSend}>
                        Pay
                     </Button>
                  </div>
               </Modal.Body>
            );

         case Tabs.Send:
            return (
               <div className='flex justify-center items-center my-8'>
                  <Spinner size='xl' />
               </div>
            );

         default:
            return null;
      }
   };

   return (
      <Modal show={isSendModalOpen} onClose={() => setIsSendModalOpen(false)}>
         <Modal.Header>Send</Modal.Header>
         {isProcessing ? (
            <div className='flex justify-center items-center my-8'>
               <Spinner size='xl' />
            </div>
         ) : (
            renderTab()
         )}
      </Modal>
   );
};
