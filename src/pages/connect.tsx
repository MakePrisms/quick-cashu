import React, { useEffect } from "react";
import { useAppDispatch } from '@/redux/store';
import { initializeUser } from "@/redux/reducers/UserReducer";
import { Spinner } from "flowbite-react";
import { Relay, finalizeEvent, generateSecretKey, getPublicKey, nip04 } from "nostr-tools";
import { assembleLightningAddress } from "@/utils";
import Balance from "@/components/Balance";
import Receive from "@/components/buttons/lightning/Receive";
import Send from "@/components/buttons/lightning/Send";
import EcashButtons from "@/components/buttons/EcashButtons";
import { CashuMint, CashuWallet } from '@cashu/cashu-ts';
import { useNwc } from "@/hooks/useNwc";
import { useCashu } from "@/hooks/useCashu";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import Disclaimer from "@/components/Disclaimer";
import ActivityIndicator from "@/components/ActivityIndicator";

export default function Home() {
    const dispatch = useAppDispatch();

    const {updateProofsAndBalance} = useCashu();
    useNwc();

    useEffect(() => {
        dispatch(initializeUser());
    }, [dispatch]);

    useEffect(() => {
        updateProofsAndBalance();

        // poll for proofs every 5 seconds
        const interval = setInterval(() => {
            updateProofsAndBalance();
        }, 5000);

        return () => clearInterval(interval);
    }, [dispatch, updateProofsAndBalance]);

    const mint = new CashuMint(process.env.NEXT_PUBLIC_CASHU_MINT_URL!);

    const wallet = new CashuWallet(mint);

    const balance = useSelector((state: RootState) => state.cashu.balance);

    const handleNwa = async () => {
        let params = new URL(document.location.href).searchParams;

        // Handle 'nwa' parameter
        let nwa = params.get("nwa");
        if (nwa) {
            // Decode the nwa parameter
            let decodedNwa = decodeURIComponent(nwa);

            // remove the prefix nostr+walletauth://
            decodedNwa = decodedNwa.replace("nostr+walletauth://", "");

            // Extract the appPublicKey from the decoded NWA string
            const [appPublicKey, queryParams] = decodedNwa.split("?");

            // Parse the query parameters
            let queryParamsObj = new URLSearchParams(queryParams);

            // Extract each value
            const appRelay = queryParamsObj.get("relay");
            // encode secret as hex
            const secret = queryParamsObj.get("secret");
            const requiredCommands = queryParamsObj.get("required_commands") || "";
            const budget = queryParamsObj.get("budget");
            const identity = queryParamsObj.get("identity");

            // Log or process the extracted values as needed
            console.log("App Public Key:", appPublicKey);
            console.log("Relay:", appRelay);
            console.log("Secret:", secret);
            console.log("Required Commands:", requiredCommands);
            console.log("Budget:", budget);
            console.log("Identity:", identity);

            if (!appRelay) {
                console.log("No relay found");
                return;
            }

            const relay = await Relay.connect(appRelay);

            // let's publish a new event while simultaneously monitoring the relay for it
            let nwaSecretKey = generateSecretKey();
            let nwaPubkey = getPublicKey(nwaSecretKey);
            // encode secret as hex
            const hexEncodedSecretKey = Buffer.from(nwaSecretKey).toString('hex');
            // save appPublicKey to localStorage
            window.localStorage.setItem('appPublicKey', appPublicKey);
            // save nwa object wth appPublicKey pk and sk to localStorage
            window.localStorage.setItem('nwa', JSON.stringify({ appPublicKey, nwaPubkey, nwaSecretKey: hexEncodedSecretKey }));

            console.log("req commands:", typeof requiredCommands, requiredCommands);

            let secretJson;

            const pubkey = window.localStorage.getItem('pubkey');

            if (pubkey) {
                secretJson = JSON.stringify({
                    secret: secret,
                    commands: [
                        ...requiredCommands.split(","),
                    ],
                    relay: appRelay,
                    lud16: `${assembleLightningAddress(pubkey, window.location.host)}`
                });
            } else {
                secretJson = JSON.stringify({
                    secret: secret,
                    commands: [
                        ...requiredCommands.split(","),
                    ],
                    relay: appRelay
                });
            }

            console.log("Secret JSON:", secretJson);

            const encryptedContent = await nip04.encrypt(
                nwaSecretKey,
                appPublicKey,
                secretJson
            );

            let eventTemplate = {
                kind: 33194,
                created_at: Math.floor(Date.now() / 1000),
                tags: [["d", appPublicKey]],
                content: encryptedContent,
            };

            // this assigns the pubkey, calculates the event id and signs the event in a single step
            const signedEvent = finalizeEvent(eventTemplate, nwaSecretKey);
            console.log("Signed event:", signedEvent);
            await relay.publish(signedEvent);

            relay.close();

            setTimeout(() => {
                window.location.href = "/";
            }, 2000);
        }
    }

    useEffect(() => {
        handleNwa();
    }, []);

    return (
        <main className="flex flex-col items-center justify-center mx-auto min-h-screen">
            <Balance balance={balance} />
            <ActivityIndicator />
            <div className="py-8 w-full">
                <div className="flex flex-row justify-center mx-auto">
                    <Receive />
                    <Send wallet={wallet} />
                </div>
                {/* <EcashButtons wallet={wallet} /> */}
            </div>
            <Disclaimer />
        </main>
    );
}