import { useEffect } from 'react';
import { Relay, nip04 } from 'nostr-tools';
import { useToast } from './useToast';

export const useNwc = () => {
    const { addToast } = useToast();

    useEffect(() => {
        const connectionUri = localStorage.getItem('nwc_connectionUri');
        const secret = localStorage.getItem('nwc_secret');

        if (!connectionUri || !secret) {
            console.log('No NWC connection URI or secret found in local storage.');
            return;
        }

        const { pk, relayUrl } = parseConnectionUri(connectionUri);

        console.log(`Connecting to ${relayUrl} with public key ${pk}`);

        const listenForEvents = async () => {
            const relay = await Relay.connect(relayUrl);

            const sub = await relay.subscribe(
                [
                    {
                        authors: [pk],
                    },
                ], {
                onevent: async (event: any) => {
                    console.log('Event received:', event);
                    // decrypt the event with the secret using nip04
                    const decrypted = await nip04.decrypt(secret, pk, event.content);
                    console.log('Decrypted:', decrypted);
                    addToast('NWC event received', 'success');
                    addToast(decrypted, 'success');
                },
                onclose(reason) {
                    console.log('Subscription closed:', reason);
                }
            }
            );
        }

        listenForEvents();
    }, []);

    function extractPublicKeyFromUri(uri: any) {
        // Remove the scheme part and split by "?" to isolate the public key
        const pkPart = uri.split('://')[1].split('?')[0];
        return pkPart;
    }

    // This function parses the NWC connection URI and extracts the public key and relay URL
    function parseConnectionUri(uri: string): { pk: string; relayUrl: string } {
        const url = new URL(uri);
        const pk = extractPublicKeyFromUri(uri);
        const relayUrl = decodeURIComponent(url.searchParams.get('relay') || '');
        return { pk, relayUrl };
    }
};
