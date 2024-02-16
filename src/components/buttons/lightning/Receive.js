import React, { useState, useEffect } from "react";
import axios from "axios";
import { Button, Modal, Spinner } from "flowbite-react";
import { useToast } from "@/hooks/useToast";

const Receive = ({ wallet }) => {
    const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
    const [amount, setAmount] = useState('');
    const [isReceiving, setIsReceiving] = useState(false);
    const [invoiceToPay, setInvoiceToPay] = useState('');

    const { addToast } = useToast();

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
            const requiredCommands = queryParamsObj.get("required_commands");
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
            let sk = generateSecretKey();
            let pk = getPublicKey(sk);

            console.log("Secret key:", typeof sk, sk);
            console.log("Public key:", pk);

            let secretJson;

            const pubkey = window.localStorage.getItem('pubkey');

            if (pubkey) {
                secretJson = JSON.stringify({ secret: secret, lud16: `${pubkey}@quick-cashu.vercel.app` });
            } else {
                secretJson = JSON.stringify({ secret: secret });
            }

            const encryptedContent = await nip04.encrypt(
                sk,
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
            const signedEvent = finalizeEvent(eventTemplate, sk);
            console.log("Signed event:", signedEvent);
            await relay.publish(signedEvent);

            relay.close();
        }
    }

    useEffect(() => {
        if (window.location.pathname === '/connect') {
            handleNwa();
        }
    }, []);

    const handleReceive = async () => {
        setIsReceiving(true);
        if (!amount) {
            addToast("Please enter an amount.", "warning");
            setIsReceiving(false);
            return;
        }

        try {
            const { pr, hash } = await wallet.requestMint(parseInt(amount));

            if (!pr || !hash) {
                addToast("An error occurred while trying to receive.", "error");
                setIsReceiving(false);
                return;
            }

            setInvoiceToPay(pr);

            const pollingResponse = await axios.post(`${process.env.NEXT_PUBLIC_PROJECT_URL}/api/invoice/polling/${hash}`, {
                pubkey: window.localStorage.getItem('pubkey'),
                amount: amount,
            });

            console.log('pollingResponse', pollingResponse);

            if (pollingResponse.status === 200 && pollingResponse.data.success) {
                setTimeout(() => {
                    setIsReceiving(false);
                    addToast(`You have successfully received ${amount} sats.`, "success");
                }, 1000);
            }
        } catch (error) {
            console.error(error);
            addToast("An error occurred while trying to receive.", "error");
        } finally {
            setIsReceiving(false);
        }
    };

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            addToast("Invoice copied to clipboard.", "success");
        } catch (err) {
            console.error("Failed to copy: ", err);
            addToast("Failed to copy invoice to clipboard.", "error");
        }
    };

    return (
        <div>
            <Button onClick={() => setIsReceiveModalOpen(true)} color="warning">Receive</Button>
            <Modal show={isReceiveModalOpen} onClose={() => setIsReceiveModalOpen(false)}>
                <Modal.Header>Receive Lightning Payment</Modal.Header>
                {isReceiving && !invoiceToPay ? (
                    <div className="flex justify-center items-center my-8">
                        <Spinner size="xl" />
                    </div>
                ) : (
                    <>
                        <Modal.Body>
                            {invoiceToPay ? (
                                <>
                                    <div className="space-y-6">
                                        <input
                                            className="form-control block w-full px-3 py-1.5 text-base font-normal text-gray-700 bg-white bg-clip-padding border border-solid border-gray-300 rounded transition ease-in-out m-0 focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none"
                                            type="text"
                                            value={invoiceToPay}
                                            readOnly
                                        />
                                    </div>
                                    <Modal.Footer className="w-full flex flex-row justify-end">
                                        <Button color="success" onClick={() => copyToClipboard(invoiceToPay)}>
                                            Copy
                                        </Button>
                                    </Modal.Footer>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-6">
                                        <input
                                            className="form-control block w-full px-3 py-1.5 text-base font-normal text-gray-700 bg-white bg-clip-padding border border-solid border-gray-300 rounded transition ease-in-out m-0 focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none"
                                            type="number"
                                            placeholder="Enter amount"
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value)}
                                        />
                                    </div>
                                    <Modal.Footer>
                                        <Button color="failure" onClick={() => setIsReceiveModalOpen(false)}>
                                            Cancel
                                        </Button>
                                        <Button color="success" onClick={handleReceive}>
                                            Submit
                                        </Button>
                                    </Modal.Footer>
                                </>
                            )}
                        </Modal.Body>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default Receive;