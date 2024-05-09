import { useSelector } from 'react-redux';
import { useNDK } from './useNDK';
import { RootState, useAppDispatch } from '@/redux/store';
import { setLastNwcReqTimestamp } from '@/redux/slices/NwcSlice';
import { NDKEvent, NDKFilter, NDKKind, NostrEvent } from '@nostr-dev-kit/ndk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nip04 } from 'nostr-tools';
import { getAmountFromInvoice } from '@/utils/bolt11';
import { useExchangeRate } from './useExchangeRate';
import { useCashu } from './useCashu';

enum ErrorCodes {
   NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
   UNAUTHORIZED = 'UNAUTHORIZED',
   INTERNAL = 'INTERNAL',
   OTHER = 'OTHER',
   RESTRICTED = 'RESTRICTED',
   QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
   INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
   // TODO: add remaining nip47 error
}

export enum NWCMethods {
   payInvoice = 'pay_invoice',
   //  makeInvoice = 'make_invoice',
   //  payKeysend = 'pay_keysend',
   //  listTransactions = 'list_transactions',
   //  lookupInvoice = 'lookup_invoice',
   //  getBalance = 'get_balance',
   //  getInfo = 'get_info',
   //  multiPayInvoice = 'multi_pay_invoice',
   //  multiPayKeysend = 'multi_pay_keysend',
}

type NWCPayResponse = {
   preimage: string;
};

type NWCPayInvoiceRequest = {
   invoice: string;
   amount?: number; // msats
};

type NWCRequestParams = NWCPayInvoiceRequest;

type NWCRequestContent = {
   method: NWCMethods;
   params: NWCRequestParams;
};

type NWCResult = NWCPayResponse;

type NWCResponseContent = {
   result_type: NWCMethods;
   result?: NWCPayResponse;
   error?: {
      code: ErrorCodes;
      message?: string;
   };
};

// type NWCResponseContent = {
//    result_type: NWCMethods;
//    result?: {
//       invoice?: string;
//       // TODO: fill in other potential result data types
//    };
//    error?: {
//       code: string;
//       message?: string;
//    };
// };

export class NWCError extends Error {
   constructor(
      public readonly code: ErrorCodes,
      message?: string,
   ) {
      super(message);
   }
}

interface Nwc2Props {
   privkey?: string;
   pubkey?: string;
}

const useNwc2 = ({ privkey, pubkey }: Nwc2Props) => {
   const [nip47RequestFilter, setNip47RequestFilter] = useState<NDKFilter | undefined>(undefined);
   const seenEventIds = useRef<Set<string>>(new Set());

   const balance = useSelector((state: RootState) => state.wallet.balance.usd);

   const nwcState = useSelector((state: RootState) => state.nwc);
   const nwcStateRef = useRef(nwcState);
   nwcStateRef.current = nwcState;

   const { subscribeAndHandle, publishNostrEvent } = useNDK();
   const { payInvoice: cashuPayInvoice } = useCashu();
   const { satsToUnit } = useExchangeRate();
   const dispatch = useAppDispatch();

   const payInvoice = useCallback(
      async (params: NWCRequestParams): Promise<NWCPayResponse> => {
         const isPayInvoiceRequest = (params: NWCRequestParams): params is NWCPayInvoiceRequest => {
            return 'invoice' in params;
         };

         if (!isPayInvoiceRequest(params)) {
            throw new NWCError(ErrorCodes.OTHER, 'Invalid request params');
         }

         const { invoice, amount } = params;

         if (amount) {
            throw new NWCError(ErrorCodes.NOT_IMPLEMENTED, 'Amount is not supported');
         }

         const result = await cashuPayInvoice(invoice);

         // TODO
         // dispatch(incrementConnectionSpent({ pubkey: connectionPubkey, spent: result.amountUsd}));

         return { preimage: result.preimage };
      },
      [cashuPayInvoice],
   );

   // Store the handlers map in a ref to maintain a consistent reference across renders
   const requestHandlers = useRef(
      new Map<NWCMethods, (params: NWCRequestParams) => Promise<NWCResult>>(),
   );

   /**
    * Init request handlers
    */
   useEffect(() => {
      // Initialize or update the map; this effect runs only when handlers change
      requestHandlers.current.set(NWCMethods.payInvoice, payInvoice);
   }, [payInvoice]); // Ensure this runs when handlers are re-created

   /**
    * set the nwc request (kind 23194) filter
    */
   useEffect(() => {
      if (!pubkey) return;

      const filter: NDKFilter = {
         kinds: [NDKKind.NostrWalletConnectReq],
         // authors: nwcState.allPubkeys,
         '#p': [pubkey],
         since: Math.floor(Date.now() / 1000), // TODO
      };

      console.log('Setting NIP47 Request Filter: ', filter);

      setNip47RequestFilter(filter);
   }, [pubkey]);

   const sendNwcResponse = useCallback(
      async (method: NWCMethods, requestEvent: NDKEvent, result?: NWCResult, error?: NWCError) => {
         const requestId = requestEvent.id;
         const appPubkey = requestEvent.pubkey;

         const content: NWCResponseContent = {
            result_type: method,
         };

         if (result) {
            content['result'] = result;
         } else if (error) {
            content['error'] = { code: error.code, message: error.message };
         } else {
            throw new Error('sendNwcResponse requires a result or an NWCError');
         }

         console.log('## SENDING NWC RESPONSE: ', content);

         // TODO: use nip04 to encrypt the content with app's pubkey and our private key
         const encryptedResponse = await nip04.encrypt(
            privkey!,
            appPubkey,
            JSON.stringify(content),
         );

         // construct the kind 23195 response
         const responseEvent: NostrEvent = {
            kind: NDKKind.NostrWalletConnectRes,
            tags: [
               ['e', requestId],
               ['p', appPubkey],
            ],
            content: encryptedResponse,
            created_at: Math.floor(Date.now() / 1000),
            pubkey: pubkey!,
         };

         try {
            await publishNostrEvent(responseEvent).then(() => console.log('## RESPONSE PUBLISHED'));
         } catch (e) {
            console.error(
               'Error publishing response event. Make sure your are signed in and connected to relays...',
               e,
            );
         }
      },
      [privkey, pubkey, publishNostrEvent],
   );

   /**
    * Use NIP04 to decrypt
    * @param appPubkey The public key of the app the nwc connection was issued to
    * @param encryptedContent Encrypted event content that contains nip47 request data
    * @returns nip47 method and corresponding params
    */
   const decryptNwcRequest = useCallback(
      async (appPubkey: string, encryptedContent: string): Promise<NWCRequestContent> => {
         if (!privkey) throw new NWCError(ErrorCodes.INTERNAL, 'Failed to init');

         // use NIP04 for decrypt with app's pubkey and OUR private key
         const decrypted = await nip04.decrypt(privkey, appPubkey, encryptedContent);

         // parse decrypted content
         const parsedRequest = JSON.parse(decrypted);

         // make sure we have a method and params
         if (!parsedRequest.method || !parsedRequest.params) {
            throw new NWCError(ErrorCodes.OTHER, 'Invalid NWC request');
         }

         // validate the params agains the method
         switch (parsedRequest.method) {
            case NWCMethods.payInvoice:
               if (!parsedRequest.params.invoice) {
                  throw new NWCError(ErrorCodes.OTHER, 'Invalid NWC request');
               }
               break;
            default:
               throw new NWCError(ErrorCodes.NOT_IMPLEMENTED, 'Method not implemented');
         }

         const method = parsedRequest.method as NWCMethods;
         const params = parsedRequest.params;

         // NOTE: if the request is bad just ignore it because we may not have method or even been able to decrypt

         return { method, params };
      },
      [privkey],
   );

   const validateConnection = useCallback(
      async (appPubkey: string, request: NWCRequestContent) => {
         const currentState = nwcStateRef.current;

         if (!currentState.allPubkeys.includes(appPubkey)) {
            console.log('ALL PUBKEYS: ', currentState.allPubkeys);
            throw new NWCError(ErrorCodes.UNAUTHORIZED, 'Unauthorized app');
         }

         const connection = currentState.connections[appPubkey];

         if (!connection.permissions.includes(request.method)) {
            console.warn('## Connection permissions: ', connection.permissions, request.method);
            throw new NWCError(ErrorCodes.RESTRICTED, 'Method not allowed');
         }

         if (connection.expiry && Date.now() / 1000 > connection.expiry) {
            console.log('## NOW: ', Date.now() / 1000, 'EXPIRY: ', connection.expiry);
            throw new NWCError(ErrorCodes.UNAUTHORIZED, 'Connection expired');
         }

         if (request.method === NWCMethods.payInvoice) {
            let amount;
            if (request.params.amount) {
               amount = Math.floor(request.params.amount / 1000);
            } else {
               amount = getAmountFromInvoice(request.params.invoice);
            }

            console.log('## AMOUNT SATS: ', amount);

            const amountUsd = await satsToUnit(amount, 'usd');
            if (connection.budget && amountUsd / 100 > connection.budget - connection.spent) {
               console.log(
                  `## AMOUNT USD: ${amountUsd / 100}\n## REMAINING BUDGET: ${connection.budget - connection.spent}`,
               );
               throw new NWCError(ErrorCodes.QUOTA_EXCEEDED);
            }

            console.log('## AMOUNT USD: ', amountUsd);

            if (amountUsd / 100 > balance) {
               console.log(`## CURRENT BALANCE: ${balance}`);
               throw new NWCError(ErrorCodes.INSUFFICIENT_BALANCE);
            }
         }
      },
      [balance, satsToUnit, nwcStateRef],
   );

   const handleNwcRequest = useCallback(
      async (event: NDKEvent) => {
         if (seenEventIds.current.has(event.id)) return;
         seenEventIds.current.add(event.id);
         dispatch(setLastNwcReqTimestamp(event.created_at!));
         const request = await decryptNwcRequest(event.pubkey, event.content);

         console.log(`============PROCESSING NWC REQUEST===============\n ## REQUEST: ${request}`);

         try {
            await validateConnection(event.pubkey, request);

            console.log('## CONNECTION IS VALID');

            const handler = requestHandlers.current.get(request.method);

            if (!handler) {
               throw new NWCError(ErrorCodes.NOT_IMPLEMENTED, 'Method not implemented');
            }

            const result = await handler(request.params);

            await sendNwcResponse(request.method, event, result);
         } catch (e) {
            if (e instanceof NWCError) {
               sendNwcResponse(request.method, event, undefined, e);
            } else {
               console.error('Error processing NWC request', e);
               sendNwcResponse(
                  request.method,
                  event,
                  undefined,
                  new NWCError(ErrorCodes.INTERNAL, 'Failed to process request'),
               );
            }
         }
      },
      [sendNwcResponse, decryptNwcRequest, validateConnection, dispatch],
   );

   /**
    * create a subscription for NIP47 requests and handle them
    */
   useEffect(() => {
      if (nip47RequestFilter) {
         console.log('Subscribing to NIP47 requests');
         subscribeAndHandle(nip47RequestFilter, handleNwcRequest, { closeOnEose: false });
      }
   }, [nip47RequestFilter, subscribeAndHandle, handleNwcRequest]);
};

export default useNwc2;
